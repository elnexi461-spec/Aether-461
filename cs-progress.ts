// ─────────────────────────────────────────────────────────────────────────────
// CS ACADEMIC PROGRESS MODULE
// RAG-powered knowledge base for Computer Science studies.
// Uses Vectorize for semantic search and Workers AI for embeddings + synthesis.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  Env,
  CSCourse,
  KnowledgeChunk,
  CSProgress,
  RAGQueryResult,
  CourseStatus,
  ContentType,
  AIMessage,
} from "../types.js";

// Embedding model constants
const EMBEDDING_MODEL = "@cf/baai/bge-large-en-v1.5";
const EMBEDDING_DIMENSIONS = 1024;
const RAG_TOP_K = 5;
const RAG_MIN_SCORE = 0.6;
const MAX_CONTEXT_CHARS = 3000;

function generateId(): string {
  return crypto.randomUUID();
}

function isoNow(): string {
  return new Date().toISOString();
}

function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars) + "…" : text;
}

// ── CS Progress Class ─────────────────────────────────────────────────────────

export class CSProgressTracker {
  private readonly ai: Ai;
  private readonly vectorize: VectorizeIndex;
  private readonly db: D1Database;

  constructor(env: Env) {
    this.ai = env.AI;
    this.vectorize = env.VECTORIZE;
    this.db = env.DB;
  }

  // ── Course Management ──────────────────────────────────────────────────────

  async addCourse(userId: string, input: Omit<CSCourse, "id" | "progress">): Promise<CSCourse> {
    const id = generateId();
    const course: CSCourse = {
      ...input,
      id,
      progress: 0,
      completedTopics: 0,
    };

    await this.db
      .prepare(
        `INSERT INTO cs_courses
          (id, user_id, name, institution, semester, status, progress, total_topics, completed_topics, tags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        userId,
        course.name,
        course.institution ?? null,
        course.semester ?? null,
        course.status,
        course.progress,
        course.totalTopics,
        course.completedTopics,
        JSON.stringify(course.tags)
      )
      .run();

    return course;
  }

  async updateCourseProgress(
    userId: string,
    courseId: string,
    completedTopics: number,
    status?: CourseStatus
  ): Promise<void> {
    const course = await this.db
      .prepare(`SELECT total_topics FROM cs_courses WHERE id = ? AND user_id = ?`)
      .bind(courseId, userId)
      .first<{ total_topics: number }>();

    if (!course) throw new Error(`Course ${courseId} not found`);

    const progress = course.total_topics > 0
      ? Math.min(100, Math.round((completedTopics / course.total_topics) * 100))
      : 0;

    const derivedStatus: CourseStatus =
      status ?? (progress >= 100 ? "COMPLETED" : progress > 0 ? "IN_PROGRESS" : "NOT_STARTED");

    await this.db
      .prepare(
        `UPDATE cs_courses
         SET completed_topics = ?, progress = ?, status = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`
      )
      .bind(completedTopics, progress, derivedStatus, isoNow(), courseId, userId)
      .run();
  }

  // ── Knowledge Base (RAG) ───────────────────────────────────────────────────

  async ingestKnowledge(
    userId: string,
    courseId: string,
    topic: string,
    content: string,
    contentType: ContentType = "NOTES"
  ): Promise<KnowledgeChunk> {
    const id = generateId();
    const addedAt = isoNow();

    // Generate embedding via Workers AI
    const embeddingResponse = (await this.ai.run(EMBEDDING_MODEL, {
      text: [content],
    })) as { data: number[][] };

    const vector = embeddingResponse.data[0];
    if (!vector || vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Embedding dimension mismatch: expected ${EMBEDDING_DIMENSIONS}, got ${vector?.length ?? 0}`);
    }

    const embeddingId = `chunk_${userId}_${id}`;

    // Upsert into Vectorize
    await this.vectorize.upsert([
      {
        id: embeddingId,
        values: vector,
        metadata: {
          userId,
          courseId,
          chunkId: id,
          topic,
          contentType,
          preview: truncate(content, 200),
        },
      },
    ]);

    // Persist metadata to D1
    const chunk: KnowledgeChunk = {
      id,
      courseId,
      topic,
      contentType,
      content,
      embeddingId,
      addedAt,
    };

    await this.db
      .prepare(
        `INSERT INTO knowledge_chunks
          (id, user_id, course_id, topic, content_type, content, embedding_id, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, userId, courseId, topic, contentType, content, embeddingId, addedAt)
      .run();

    return chunk;
  }

  async queryKnowledge(userId: string, query: string): Promise<RAGQueryResult> {
    // Embed the query
    const embeddingResponse = (await this.ai.run(EMBEDDING_MODEL, {
      text: [query],
    })) as { data: number[][] };

    const queryVector = embeddingResponse.data[0];
    if (!queryVector) {
      throw new Error("Failed to embed query");
    }

    // Semantic search in Vectorize with user filter
    const searchResults = await this.vectorize.query(queryVector, {
      topK: RAG_TOP_K,
      filter: { userId },
      returnMetadata: "all",
    });

    // Filter by minimum score
    const relevant = searchResults.matches.filter((m) => m.score >= RAG_MIN_SCORE);

    if (relevant.length === 0) {
      return {
        query,
        relevantChunks: [],
        synthesizedAnswer: "No relevant knowledge found in your knowledge base for this query. Try adding lecture notes or course material first.",
      };
    }

    // Fetch full content from D1 for the matched chunk IDs
    const chunkIds = relevant.map((r) => r.metadata?.["chunkId"] as string).filter(Boolean);
    const placeholders = chunkIds.map(() => "?").join(", ");
    const chunkRows = await this.db
      .prepare(`SELECT id, topic, content FROM knowledge_chunks WHERE id IN (${placeholders}) AND user_id = ?`)
      .bind(...chunkIds, userId)
      .all<{ id: string; topic: string; content: string }>();

    const chunkMap = new Map(chunkRows.results.map((c) => [c.id, c]));

    const relevantChunks = relevant.map((match) => {
      const cid = match.metadata?.["chunkId"] as string;
      const chunk = chunkMap.get(cid);
      return {
        id: cid ?? match.id,
        topic: (match.metadata?.["topic"] as string) ?? chunk?.topic ?? "Unknown",
        content: chunk?.content ?? (match.metadata?.["preview"] as string) ?? "",
        score: match.score,
      };
    });

    // Build context window (truncate to fit AI context)
    let contextText = "";
    for (const chunk of relevantChunks) {
      const candidate = `[${chunk.topic}]\n${chunk.content}\n\n`;
      if ((contextText + candidate).length > MAX_CONTEXT_CHARS) break;
      contextText += candidate;
    }

    // Synthesize answer with LLM
    const messages: AIMessage[] = [
      {
        role: "system",
        content: `You are Aether's CS Academic Assistant — a world-class computer science tutor.
Answer questions precisely using ONLY the provided knowledge base context.
If the context is insufficient, say so explicitly. Use technical accuracy.
Format code snippets with language labels. Be concise but complete.`,
      },
      {
        role: "user",
        content: `KNOWLEDGE BASE CONTEXT:
${contextText}

STUDENT QUESTION: ${query}

Answer the question using only the context above. If relevant code examples exist in the context, include them.`,
      },
    ];

    const aiResponse = (await this.ai.run("@cf/meta/llama-3.1-70b-instruct", {
      messages,
      max_tokens: 600,
    })) as { response: string };

    return {
      query,
      relevantChunks,
      synthesizedAnswer: aiResponse.response.trim(),
    };
  }

  // ── Progress Analytics ────────────────────────────────────────────────────

  async loadProgress(userId: string): Promise<CSProgress> {
    const courseRows = await this.db
      .prepare(`SELECT * FROM cs_courses WHERE user_id = ? ORDER BY updated_at DESC`)
      .bind(userId)
      .all<Record<string, unknown>>();

    const chunkRows = await this.db
      .prepare(`SELECT id, course_id, topic, content_type, content, embedding_id, added_at FROM knowledge_chunks WHERE user_id = ? ORDER BY added_at DESC LIMIT 100`)
      .bind(userId)
      .all<Record<string, unknown>>();

    const streakData = await this.db
      .prepare(
        `SELECT date(added_at) as study_date FROM knowledge_chunks WHERE user_id = ?
         GROUP BY date(added_at) ORDER BY study_date DESC LIMIT 30`
      )
      .bind(userId)
      .all<{ study_date: string }>();

    const courses: CSCourse[] = (courseRows.results ?? []).map((r) => ({
      id: r["id"] as string,
      name: r["name"] as string,
      institution: r["institution"] as string | undefined,
      semester: r["semester"] as string | undefined,
      status: r["status"] as CourseStatus,
      progress: r["progress"] as number,
      totalTopics: r["total_topics"] as number,
      completedTopics: r["completed_topics"] as number,
      tags: JSON.parse((r["tags"] as string) ?? "[]") as string[],
    }));

    const knowledgeChunks: KnowledgeChunk[] = (chunkRows.results ?? []).map((r) => ({
      id: r["id"] as string,
      courseId: r["course_id"] as string,
      topic: r["topic"] as string,
      contentType: r["content_type"] as ContentType,
      content: r["content"] as string,
      embeddingId: r["embedding_id"] as string | undefined,
      addedAt: r["added_at"] as string,
    }));

    // Calculate study streak
    const dates = (streakData.results ?? []).map((r) => r.study_date);
    let streakDays = 0;
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400_000).toISOString().slice(0, 10);
    const lastStudy = dates[0];

    if (lastStudy === today || lastStudy === yesterday) {
      streakDays = 1;
      for (let i = 1; i < dates.length; i++) {
        const curr = dates[i] ?? "";
        const prev = dates[i - 1] ?? "";
        const dayDiff =
          (new Date(prev).getTime() - new Date(curr).getTime()) / 86400_000;
        if (dayDiff === 1) {
          streakDays++;
        } else {
          break;
        }
      }
    }

    return {
      courses,
      knowledgeChunks,
      studyStreakDays: streakDays,
      lastStudyDate: lastStudy,
    };
  }

  async generateStudyPlan(userId: string, progress: CSProgress): Promise<string> {
    if (progress.courses.length === 0) {
      return "No courses tracked yet. Add a course to generate a personalized study plan.";
    }

    const courseSummary = progress.courses.map((c) =>
      `- ${c.name} (${c.institution ?? "Self-study"}): ${c.completedTopics}/${c.totalTopics} topics, ${c.status}`
    ).join("\n");

    const topicCoverage = progress.knowledgeChunks.length;
    const messages: AIMessage[] = [
      {
        role: "system",
        content: `You are Aether's CS Academic Coach. Design evidence-based study plans using spaced repetition and active recall.
Be specific about time allocation, resources, and milestones. Maximum 350 words.`,
      },
      {
        role: "user",
        content: `Generate a personalized weekly study plan:

COURSES:
${courseSummary}

KNOWLEDGE BASE: ${topicCoverage} chunks ingested
STUDY STREAK: ${progress.studyStreakDays} days
LAST STUDY DATE: ${progress.lastStudyDate ?? "Never"}

Provide: daily time blocks, priority topics, review schedule, and one practice problem suggestion per active course.`,
      },
    ];

    const response = (await this.ai.run("@cf/meta/llama-3.1-70b-instruct", {
      messages,
      max_tokens: 500,
    })) as { response: string };

    return response.response.trim();
  }
}
