// ─────────────────────────────────────────────────────────────────────────────
// ALPHA HUNTER MODULE
// Analyzes Web3 airdrop opportunities, scores projects for ROI potential,
// and manages the user's airdrop farming portfolio.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Env,
  AirdropProject,dropStatusnd(userId)
      .first<{ total: number }>();

    const projects: AirdropProject[] = (projectRows.results ?? []).map((r) => ({
      id: r["id"] as string,
      name: r["name"] as string,
      ticker: r["ticker"] as string,
      network: r["network"] as string,
      tvl: r["tvl"] as number | undefined,
      fundingRaised: r["funding_raised"] as number | undefined,
      taskDescription: r["task_description"] as string,
      estimatedROI: r["estimated_roi"] as number | undefined,
      riskTier: r["risk_tier"] as AirdropRiskTier,
      status: r["status"] as AirdropStatus,
      addedAt: r["added_at"] as string,
      lastActionAt: r["last_action_at"] as string | undefined,
      notes: r["notes"] as string | undefined,
      tags: JSON.parse((r["tags"] as string) ?? "[]") as string[],
    }));

    return {
      projects,
      totalEarningsUSD: earningsRow?.total ?? 0,
    };
  }

  // ── AI-Powered Analysis ────────────────────────────────────────────────────

  async analyzeProject(
    project: AirdropProject,
    userRiskTolerance: AirdropRiskTier = "MODERATE"
  ): Promise<AlphaHunterAnalysis> {
    const messages: AIMessage[] = [
      {
        role: "system",
        content: `You are Aether's Alpha Hunter — an elite Web3 analyst specializing in airdrop farming.
You assess DeFi projects for airdrop eligibility, ROI potential, and execution risk.
Your analysis is precise, data-driven, and calibrated to real historical airdrop outcomes.
User risk tolerance: ${userRiskTolerance}.
Respond ONLY with a valid JSON object, no markdown fences.`,
      },
      {
        role: "user",
        content: `Analyze this airdrop opportunity and return a JSON AlphaHunterAnalysis object:
{
  "projectId": "${project.id}",
  "roiScore": <0-100 int>,
  "riskScore": <0-100 int>,
  "urgency": <"IMMEDIATE"|"THIS_WEEK"|"THIS_MONTH"|"MONITOR">,
  "recommendation": <one sentence action>,
  "tasksToComplete": [<array of specific farming tasks>],
  "reasoning": <2-3 sentence expert reasoning>
}

Project Data:
- Name: ${project.name} (${project.ticker})
- Network: ${project.network}
- TVL: ${project.tvl ? `$${(project.tvl / 1e6).toFixed(1)}M` : "Unknown"}
- Funding Raised: ${project.fundingRaised ? `$${(project.fundingRaised / 1e6).toFixed(1)}M` : "Unknown"}
- Pre-computed ROI Estimate: ${project.estimatedROI ?? "N/A"}/100
- Task Description: ${project.taskDescription}
- Tags: ${project.tags.join(", ") || "None"}
- Current Status: ${project.status}
`,
      },
    ];

    const response = (await this.ai.run("@cf/meta/llama-3.1-70b-instruct", {
      messages,
      max_tokens: 600,
    })) as { response: string };

    try {
      const raw = response.response.trim();
      const jsonStart = raw.indexOf("{");
      const jsonEnd = raw.lastIndexOf("}");
      if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON in response");
      return JSON.parse(raw.slice(jsonStart, jsonEnd + 1)) as AlphaHunterAnalysis;
    } catch {
      // Fallback: construct a deterministic analysis if AI output is malformed
      return {
        projectId: project.id,
        roiScore: project.estimatedROI ?? 0,
        riskScore: project.riskTier === "DEGEN" ? 80 : project.riskTier === "MODERATE" ? 50 : 20,
        urgency: "MONITOR",
        recommendation: `Monitor ${project.name} — complete the required tasks before snapshot.`,
        tasksToComplete: [project.taskDescription],
        reasoning: "AI analysis unavailable. Estimate based on TVL and funding signals.",
      };
    }
  }

  async generatePortfolioReport(portfolio: AirdropPortfolio): Promise<string> {
    if (portfolio.projects.length === 0) {
      return "Portfolio is empty. Add projects to begin farming.";
    }

    const activeProjects = portfolio.projects.filter((p) => p.status === "TRACKING" || p.status === "ELIGIBLE");
    const topByROI = [...activeProjects].sort((a, b) => (b.estimatedROI ?? 0) - (a.estimatedROI ?? 0)).slice(0, 5);

    const messages: AIMessage[] = [
      {
        role: "system",
        content: `You are Aether's Alpha Hunter. Generate a concise portfolio status report for a Web3 airdrop farmer.
Be direct, tactical, and informative. No fluff. Maximum 400 words.`,
      },
      {
        role: "user",
        content: `Generate a portfolio status report for this airdrop farming portfolio:

Total Earnings: $${portfolio.totalEarningsUSD.toFixed(2)} USD
Total Projects: ${portfolio.projects.length}
Active/Tracking: ${activeProjects.length}
Claimed: ${portfolio.projects.filter((p) => p.status === "CLAIMED").length}

Top 5 by Estimated ROI:
${topByROI.map((p) => `- ${p.name} (${p.ticker}) | ROI Score: ${p.estimatedROI ?? 0} | Risk: ${p.riskTier} | Network: ${p.network}`).join("\n")}

Include: priority actions this week, any urgent opportunities, and risk assessment.`,
      },
    ];

    const response = (await this.ai.run("@cf/meta/llama-3.1-70b-instruct", {
      messages,
      max_tokens: 500,
    })) as { response: string };

    return response.response.trim();
  }
}
