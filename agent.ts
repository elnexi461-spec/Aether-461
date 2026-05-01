// ─────────────────────────────────────────────────────────────────────────────
// AETHER AGENT — STATEFUL DURABLE OBJECT
// Built on @cloudflare/agents SDK (Agent class wraps Durable Objects).
// One instance per user, keyed by userId. All state is persisted automatically.
// ─────────────────────────────────────────────────────────────────────────────

import { Agent } from "agents";

import { AlphaHunter } from "./modules/alpha-hunter.js";
import { BodybuildingCoach, calculateMacros, generateOverloadRecommendations } from "./modules/bodybuilding-coach.js";
import { CSProgressTracker } from "./modules/cs-progress.js";
import {
  scrapeLinkedInPerson,
  scrapeLinkedInCompany,
  searchLinkedInPeople,
  scrapeInstagram,
  enrichAirdropTeam,
} from "./modules/intel-scrapers.js";
import {
  triggerAlphaPayment,
  getPaymentHistory,
  verifyUsdcPaymentOnBase,
  build402Gate,
  ALPHA_PAYMENT_THRESHOLD,
  ALPHA_PAYMENT_AMOUNT_USDC,
} from "./modules/x402-payment.js";

import type {
  Env,
  AetherState,
  AetherRequest,
  AetherResponse,
  AirdropProject,
  AirdropRiskTier,
  AirdropStatus,
  WorkoutSession,
  ExerciseLog,
  UserPhysique,
  CSCourse,
  CourseStatus,
  ContentType,
  ModuleTarget,
} from "./types.js";

const AGENT_VERSION = "1.0.0";

function isoNow(): string {
  return new Date().toISOString();
}

function ok<T>(module: ModuleTarget, action: string, data: T, startMs: number): AetherResponse<T> {
  return {
    success: true,
    module,
    action,
    data,
    timestamp: isoNow(),
    processingMs: Date.now() - startMs,
  };
}

function err(module: ModuleTarget, action: string, error: unknown, startMs: number): AetherResponse {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Aether] ${module}:${action} error:`, message);
  return {
    success: false,
    module,
    action,
    error: message,
    timestamp: isoNow(),
    processingMs: Date.now() - startMs,
  };
}

// ── AetherAgent ───────────────────────────────────────────────────────────────

export class AetherAgent extends Agent<Env, AetherState> {
  // The Agent SDK automatically persists `this.state` across requests
  // via Durable Object storage. setState() triggers a durable write.

  private getModules() {
    return {
      alpha: new AlphaHunter(this.env),
      body: new BodybuildingCoach(this.env),
      cs: new CSProgressTracker(this.env),
    };
  }

  private getUserId(): string {
    // userId is encoded in the DO name (set by the router in index.ts)
    return this.name;
  }

  private ensureState(): void {
    if (!this.state.userId) {
      this.setState({
        userId: this.getUserId(),
        createdAt: isoNow(),
        lastActiveAt: isoNow(),
        airdropPortfolio: {
          projects: [],
          totalEarningsUSD: 0,
        },
        bodybuilding: {
          sessions: [],
          personalRecords: {},
        },
        csProgress: {
          courses: [],
          knowledgeChunks: [],
          studyStreakDays: 0,
        },
        agentVersion: AGENT_VERSION,
      });
    }
  }

  private touch(): void {
    this.setState({ ...this.state, lastActiveAt: isoNow() });
  }

  // ── HTTP Request Handler ──────────────────────────────────────────────────

  override async onRequest(request: Request): Promise<Response> {
    this.ensureState();

    // Health check
    if (request.method === "GET" && new URL(request.url).pathname.endsWith("/status")) {
      return Response.json({
        agent: "AetherAgent",
        version: AGENT_VERSION,
        userId: this.getUserId(),
        createdAt: this.state.createdAt,
        lastActiveAt: this.state.lastActiveAt,
        modules: {
          alphaProjects: this.state.airdropPortfolio?.projects?.length ?? 0,
          workoutSessions: this.state.bodybuilding?.sessions?.length ?? 0,
          csKnowledgeChunks: this.state.csProgress?.knowledgeChunks?.length ?? 0,
        },
        healthy: true,
      });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    let body: AetherRequest;
    try {
      body = (await request.json()) as AetherRequest;
    } catch {
      return Response.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
    }

    this.touch();

    const result = await this.dispatch(body);
    const status = result.success ? 200 : result.error?.includes("not found") ? 404 : 500;
    return Response.json(result, { status });
  }

  // ── Module Dispatcher ─────────────────────────────────────────────────────

  private async dispatch(req: AetherRequest): Promise<AetherResponse> {
    const t = Date.now();
    const { module, action, payload } = req;
    const userId = this.getUserId();
    const m = this.getModules();

    try {
      switch (module) {

        // ── ALPHA HUNTER ─────────────────────────────────────────────────────
        case "alpha": {
          switch (action) {

            case "add_project": {
              const p = payload as Omit<AirdropProject, "id" | "addedAt" | "estimatedROI">;
              const project = await m.alpha.addProject(userId, p);
              const portfolio = await m.alpha.loadPortfolio(userId);
              this.setState({ ...this.state, airdropPortfolio: portfolio });
              await this.logEvent(userId, "alpha", "add_project", `Added ${project.name} (${project.ticker})`);
              return ok("alpha", action, project, t);
            }

            case "update_status": {
              const { projectId, status, notes } = payload as {
                projectId: string;
                status: AirdropStatus;
                notes?: string;
              };
              await m.alpha.updateProjectStatus(userId, projectId, status, notes);
              const portfolio = await m.alpha.loadPortfolio(userId);
              this.setState({ ...this.state, airdropPortfolio: portfolio });
              return ok("alpha", action, { projectId, status }, t);
            }

            case "log_earning": {
              const { projectId, projectName, ticker, amountTokens, amountUSD, txHash } = payload as {
                projectId: string;
                projectName: string;
                ticker: string;
                amountTokens: number;
                amountUSD: number;
                txHash?: string;
              };
              await m.alpha.logEarning(userId, projectId, projectName, ticker, amountTokens, amountUSD, txHash);
              const portfolio = await m.alpha.loadPortfolio(userId);
              this.setState({ ...this.state, airdropPortfolio: portfolio });
              await this.logEvent(userId, "alpha", "log_earning", `Claimed ${amountUSD} USD from ${projectName}`);
              return ok("alpha", action, { amountUSD, totalEarningsUSD: portfolio.totalEarningsUSD }, t);
            }

            case "analyze_project": {
              const { projectId, riskTolerance } = payload as {
                projectId: string;
                riskTolerance?: AirdropRiskTier;
              };
              const portfolio = await m.alpha.loadPortfolio(userId);
              const project = portfolio.projects.find((p) => p.id === projectId);
              if (!project) return err("alpha", action, new Error(`Project ${projectId} not found`), t);
              const analysis = await m.alpha.analyzeProject(project, riskTolerance);

              // ── AUTONOMOUS x402 PAYMENT TRIGGER ──────────────────────────
              // When Alpha Hunter identifies a HIGH-VALUE opportunity (roiScore > 80),
              // Aether autonomously initiates a $0.05 USDC micropayment on Base
              // to unlock premium intelligence for that project.
              let autonomousPayment: Record<string, unknown> | undefined;
              if (analysis.roiScore >= ALPHA_PAYMENT_THRESHOLD) {
                const paymentTrigger = await triggerAlphaPayment(this.env, {
                  name: project.name,
                  roiScore: analysis.roiScore,
                  estimatedReturn: project.estimatedROI ? `${project.estimatedROI}x` : "unknown",
                  airdropValue: project.tvl ? `$${project.tvl.toLocaleString()} TVL` : "unknown",
                });
                autonomousPayment = {
                  triggered: paymentTrigger.triggered,
                  amountUsdc: ALPHA_PAYMENT_AMOUNT_USDC,
                  txHash: paymentTrigger.payment?.txHash,
                  reason: paymentTrigger.reason,
                  cdpTransferId: paymentTrigger.payment?.cdpTransferId,
                };
                if (paymentTrigger.triggered) {
                  await this.logEvent(
                    userId,
                    "alpha",
                    "autonomous_payment",
                    `x402 payment $${ALPHA_PAYMENT_AMOUNT_USDC} USDC triggered for ${project.name} (ROI: ${analysis.roiScore})`
                  );
                }
              }

              return ok("alpha", action, { ...analysis, autonomousPayment }, t);
            }

            case "portfolio_report": {
              const portfolio = await m.alpha.loadPortfolio(userId);
              const report = await m.alpha.generatePortfolioReport(portfolio);
              this.setState({
                ...this.state,
                airdropPortfolio: { ...portfolio, lastAnalyzedAt: isoNow(), analysisReport: report },
              });
              return ok("alpha", action, { report, portfolio }, t);
            }

            case "get_portfolio": {
              const portfolio = await m.alpha.loadPortfolio(userId);
              this.setState({ ...this.state, airdropPortfolio: portfolio });
              return ok("alpha", action, portfolio, t);
            }

            default:
              return err("alpha", action, new Error(`Unknown alpha action: ${action}`), t);
          }
        }

        // ── BODYBUILDING COACH ────────────────────────────────────────────────
        case "body": {
          switch (action) {

            case "log_session": {
              const sessionInput = payload as Omit<WorkoutSession, "id">;
              const session = await m.body.logSession(userId, sessionInput);
              const state = await m.body.loadState(userId);
              this.setState({ ...this.state, bodybuilding: { ...state, userPhysique: this.state.bodybuilding?.userPhysique } });
              await this.logEvent(userId, "body", "log_session", `Logged ${sessionInput.trainingDay} session`);
              return ok("body", action, session, t);
            }

            case "set_physique": {
              const physique = payload as UserPhysique;
              const macros = calculateMacros(physique);
              this.setState({
                ...this.state,
                bodybuilding: {
                  ...this.state.bodybuilding,
                  userPhysique: physique,
                  macroTargets: macros,
                },
              });
              return ok("body", action, { physique, macros }, t);
            }

            case "get_macros": {
              if (!this.state.bodybuilding?.userPhysique) {
                return err("body", action, new Error("Physique not set. Call set_physique first."), t);
              }
              const macros = calculateMacros(this.state.bodybuilding.userPhysique);
              return ok("body", action, macros, t);
            }

            case "progressive_overload": {
              const state = await m.body.loadState(userId);
              const recommendations = generateOverloadRecommendations(state.sessions, state.personalRecords);
              return ok("body", action, recommendations, t);
            }

            case "coach_note": {
              if (!this.state.bodybuilding?.userPhysique) {
                return err("body", action, new Error("Physique not set. Call set_physique first."), t);
              }
              const state = await m.body.loadState(userId);
              const note = await m.body.generateCoachNote(
                { ...state, userPhysique: this.state.bodybuilding.userPhysique },
                this.state.bodybuilding.userPhysique
              );
              this.setState({ ...this.state, bodybuilding: { ...this.state.bodybuilding, coachNote: note } });
              return ok("body", action, { note }, t);
            }

            case "generate_program": {
              if (!this.state.bodybuilding?.userPhysique) {
                return err("body", action, new Error("Physique not set. Call set_physique first."), t);
              }
              const { weeksOut } = (payload as { weeksOut?: number }) ?? {};
              const program = await m.body.generateProgram(this.state.bodybuilding.userPhysique, weeksOut);
              return ok("body", action, { program }, t);
            }

            case "get_sessions": {
              const state = await m.body.loadState(userId);
              return ok("body", action, {
                sessions: state.sessions,
                personalRecords: state.personalRecords,
              }, t);
            }

            default:
              return err("body", action, new Error(`Unknown body action: ${action}`), t);
          }
        }

        // ── CS ACADEMIC PROGRESS ──────────────────────────────────────────────
        case "cs": {
          switch (action) {

            case "add_course": {
              const courseInput = payload as Omit<CSCourse, "id" | "progress">;
              const course = await m.cs.addCourse(userId, courseInput);
              const progress = await m.cs.loadProgress(userId);
              this.setState({ ...this.state, csProgress: progress });
              await this.logEvent(userId, "cs", "add_course", `Added course: ${course.name}`);
              return ok("cs", action, course, t);
            }

            case "update_progress": {
              const { courseId, completedTopics, status } = payload as {
                courseId: string;
                completedTopics: number;
                status?: CourseStatus;
              };
              await m.cs.updateCourseProgress(userId, courseId, completedTopics, status);
              const progress = await m.cs.loadProgress(userId);
              this.setState({ ...this.state, csProgress: progress });
              return ok("cs", action, { courseId, completedTopics }, t);
            }

            case "ingest_knowledge": {
              const { courseId, topic, content, contentType } = payload as {
                courseId: string;
                topic: string;
                content: string;
                contentType?: ContentType;
              };
              const chunk = await m.cs.ingestKnowledge(userId, courseId, topic, content, contentType);
              const progress = await m.cs.loadProgress(userId);
              this.setState({ ...this.state, csProgress: progress });
              await this.logEvent(userId, "cs", "ingest_knowledge", `Ingested: ${topic}`);
              return ok("cs", action, { chunkId: chunk.id, topic }, t);
            }

            case "query": {
              const { query } = payload as { query: string };
              if (!query || query.trim().length < 3) {
                return err("cs", action, new Error("Query must be at least 3 characters"), t);
              }
              const result = await m.cs.queryKnowledge(userId, query);
              return ok("cs", action, result, t);
            }

            case "study_plan": {
              const progress = await m.cs.loadProgress(userId);
              const plan = await m.cs.generateStudyPlan(userId, progress);
              return ok("cs", action, { plan, progress }, t);
            }

            case "get_progress": {
              const progress = await m.cs.loadProgress(userId);
              this.setState({ ...this.state, csProgress: progress });
              return ok("cs", action, progress, t);
            }

            default:
              return err("cs", action, new Error(`Unknown cs action: ${action}`), t);
          }
        }

        // ── INTEL SCRAPERS (LinkedIn + Instagram) ────────────────────────────
        case "intel": {
          switch (action) {

            case "linkedin_person": {
              const { url } = payload as { url: string };
              if (!url) return err("intel", action, new Error("url is required"), t);
              const person = await scrapeLinkedInPerson(this.env, url);
              await this.logEvent(userId, "intel", "linkedin_person", `Scraped LinkedIn: ${person.name}`);
              return ok("intel", action, person, t);
            }

            case "linkedin_company": {
              const { url } = payload as { url: string };
              if (!url) return err("intel", action, new Error("url is required"), t);
              const company = await scrapeLinkedInCompany(this.env, url);
              await this.logEvent(userId, "intel", "linkedin_company", `Scraped company: ${company.name}`);
              return ok("intel", action, company, t);
            }

            case "linkedin_search": {
              const { title, location, industry, limit } = payload as {
                title: string;
                location?: string;
                industry?: string;
                limit?: number;
              };
              if (!title) return err("intel", action, new Error("title is required for LinkedIn search"), t);
              const results = await searchLinkedInPeople(this.env, { title, location, industry, limit });
              return ok("intel", action, { results, count: results.length }, t);
            }

            case "instagram_profile": {
              const { username } = payload as { username: string };
              if (!username) return err("intel", action, new Error("username is required"), t);
              const intelResult = await scrapeInstagram(this.env, username);
              await this.logEvent(
                userId,
                "intel",
                "instagram_profile",
                `Scraped @${username} — ${intelResult.profile.followers.toLocaleString()} followers`
              );
              return ok("intel", action, intelResult, t);
            }

            case "enrich_project": {
              const { projectName } = payload as { projectName: string };
              if (!projectName) return err("intel", action, new Error("projectName is required"), t);
              const enrichment = await enrichAirdropTeam(this.env, projectName);
              await this.logEvent(
                userId,
                "intel",
                "enrich_project",
                `Enriched ${projectName}: ${enrichment.founders.length} founders found`
              );
              return ok("intel", action, enrichment, t);
            }

            default:
              return err("intel", action, new Error(`Unknown intel action: ${action}`), t);
          }
        }

        // ── PAYMENT MODULE (x402 / USDC) ─────────────────────────────────────
        case "payment": {
          switch (action) {

            case "history": {
              const { limit = 20 } = (payload as { limit?: number }) ?? {};
              const history = await getPaymentHistory(this.env, limit);
              return ok("payment", action, { payments: history, count: history.length }, t);
            }

            case "verify": {
              const { txHash, expectedRecipient, expectedAmountUsdc } = payload as {
                txHash: string;
                expectedRecipient: string;
                expectedAmountUsdc: number;
              };
              if (!txHash || !expectedRecipient || !expectedAmountUsdc) {
                return err("payment", action, new Error("txHash, expectedRecipient, expectedAmountUsdc required"), t);
              }
              const result = await verifyUsdcPaymentOnBase(txHash, expectedRecipient, expectedAmountUsdc);
              return ok("payment", action, result, t);
            }

            case "gate_info": {
              const receiver = this.env.USDC_RECEIVER_ADDRESS ?? this.env.WALLET_ADDRESS_BASE ?? "";
              if (!receiver) {
                return err("payment", action, new Error("USDC_RECEIVER_ADDRESS not configured"), t);
              }
              const gate = build402Gate({
                resource: "/api/alpha/analyze_project",
                description: "Aether premium airdrop intelligence — autonomous ROI scoring + team enrichment",
                priceUsdc: ALPHA_PAYMENT_AMOUNT_USDC,
                receiverAddress: receiver,
                outputSchema: {
                  roiScore: "number (0-100)",
                  urgency: "IMMEDIATE | THIS_WEEK | THIS_MONTH | MONITOR",
                  recommendation: "string",
                  autonomousPayment: "object | undefined",
                },
              });
              return ok("payment", action, gate, t);
            }

            default:
              return err("payment", action, new Error(`Unknown payment action: ${action}`), t);
          }
        }

        // ── AGENT META ────────────────────────────────────────────────────────
        case "agent": {
          switch (action) {
            case "status": {
              return ok("agent", action, {
                userId,
                version: AGENT_VERSION,
                createdAt: this.state.createdAt,
                lastActiveAt: this.state.lastActiveAt,
                airdropProjects: this.state.airdropPortfolio?.projects?.length ?? 0,
                workoutSessions: this.state.bodybuilding?.sessions?.length ?? 0,
                csChunks: this.state.csProgress?.knowledgeChunks?.length ?? 0,
                totalEarningsUSD: this.state.airdropPortfolio?.totalEarningsUSD ?? 0,
                studyStreak: this.state.csProgress?.studyStreakDays ?? 0,
              }, t);
            }

            case "full_report": {
              // Cross-module synthesis: generate a unified life-sentinel report
              const [portfolio, bodyState, csProgress] = await Promise.all([
                m.alpha.loadPortfolio(userId),
                m.body.loadState(userId),
                m.cs.loadProgress(userId),
              ]);

              const [alphaReport, studyPlan] = await Promise.all([
                m.alpha.generatePortfolioReport(portfolio),
                m.cs.generateStudyPlan(userId, csProgress),
              ]);

              const overload = generateOverloadRecommendations(bodyState.sessions, bodyState.personalRecords);
              const physique = this.state.bodybuilding?.userPhysique;
              const macros = physique ? calculateMacros(physique) : null;

              return ok("agent", action, {
                timestamp: isoNow(),
                alpha: { report: alphaReport, totalEarningsUSD: portfolio.totalEarningsUSD },
                bodybuilding: { progressiveOverload: overload.slice(0, 5), macroTargets: macros },
                cs: { studyPlan, studyStreak: csProgress.studyStreakDays },
              }, t);
            }

            case "event_log": {
              const { limit = 20 } = (payload as { limit?: number }) ?? {};
              const events = await this.env.DB
                .prepare(`SELECT * FROM agent_events WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`)
                .bind(userId, limit)
                .all();
              return ok("agent", action, events.results, t);
            }

            default:
              return err("agent", action, new Error(`Unknown agent action: ${action}`), t);
          }
        }

        default:
          return err(module, action, new default(`Unknown module: ${module}`), t);
      }
    } catch (e) {
      return err(module, action, e, t);
    }
  }

  // ── Internal Helpers ──────────────────────────────────────────────────────

  private async logEvent(
    userId: string,
    module: string,
    action: string,
    summary: string
  ): Promise<void> {
    const id = crypto.randomUUID();
    await this.env.DB
      .prepare(
        `INSERT INTO agent_events (id, user_id, module, action, summary) VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, userId, module, action, summary)
      .run();
  }
}
