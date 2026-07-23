import { createServer } from "node:http";
import { joinSession, createCanvas } from "@github/copilot-sdk/extension";

const instances = new Map();
const CONTEXT_PROMPT_HEADER = "Please add this issue to the current session context for immediate triage:";

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
}

function summarize(text, maxLength = 280) {
    const normalized = String(text || "").replace(/\s+/g, " ").trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeIssue(issue) {
    return {
        number: Number(issue.number),
        title: String(issue.title || "Untitled issue"),
        url: String(issue.url || ""),
        description: summarize(issue.description || issue.body || "No description provided."),
        justification: String(issue.justification || ""),
        labels: Array.isArray(issue.labels) ? issue.labels.map((label) => String(label)) : [],
        updatedAt: String(issue.updatedAt || ""),
    };
}

function normalizeBoardInput(input) {
    const topIssues = Array.isArray(input?.topIssues) ? input.topIssues.map(normalizeIssue) : [];
    const backlogIssues = Array.isArray(input?.backlogIssues)
        ? input.backlogIssues.map(normalizeIssue)
        : [];
    return {
        repo: String(input?.repo || "Unknown repository"),
        topIssues,
        backlogIssues,
    };
}

function renderLabels(labels) {
    if (!labels.length) {
        return "";
    }
    return `<div class="labels">${labels
        .map((label) => `<span class="label">${escapeHtml(label)}</span>`)
        .join("")}</div>`;
}

function renderIssueCard(issue, { includeJustification = false } = {}) {
    const justification = includeJustification
        ? `<p class="why"><strong>Why now:</strong> ${escapeHtml(issue.justification || "Prioritized for immediate attention.")}</p>`
        : "";

    const updatedAt = issue.updatedAt
        ? `<p class="meta">Last updated: ${escapeHtml(issue.updatedAt)}</p>`
        : "";

    return `<article class="card" data-testid="issue-card-${issue.number}">
        <header class="card-header">
            <h3><a href="${escapeHtml(issue.url)}" target="_blank" rel="noreferrer">#${issue.number} ${escapeHtml(issue.title)}</a></h3>
        </header>
        ${renderLabels(issue.labels)}
        <p class="desc">${escapeHtml(issue.description)}</p>
        ${justification}
        ${updatedAt}
        <button
            type="button"
            class="add-btn"
            data-action="add-context"
            data-issue-number="${issue.number}"
            data-testid="add-issue-${issue.number}"
            aria-label="Add issue #${issue.number} to current context"
        >Add to current context</button>
    </article>`;
}

function renderHtml(instanceId) {
    const entry = instances.get(instanceId);
    const board = entry?.board ?? normalizeBoardInput({});
    const topIssueCards = board.topIssues.map((issue) => renderIssueCard(issue, { includeJustification: true }));
    const backlogCards = board.backlogIssues.map((issue) => renderIssueCard(issue));

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Issue triage board</title>
    <style>
      :root {
        color-scheme: dark;
      }
      body {
        margin: 0;
        padding: 1rem;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        background: #020617;
        color: #e2e8f0;
      }
      main {
        max-width: 1100px;
        margin: 0 auto;
      }
      h1 {
        margin: 0 0 0.5rem;
        font-size: 1.5rem;
      }
      .subhead {
        margin: 0 0 1rem;
        color: #94a3b8;
      }
      .section {
        margin-top: 1rem;
      }
      .section-title {
        margin: 0 0 0.75rem;
      }
      .cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
        gap: 0.75rem;
      }
      .cards-vertical {
        display: grid;
        grid-template-columns: 1fr;
        gap: 0.75rem;
      }
      .card {
        background: linear-gradient(180deg, #1e293b 0%, #0f172a 100%);
        border: 1px solid #334155;
        border-radius: 0.9rem;
        padding: 0.9rem;
        box-shadow: 0 8px 24px rgba(2, 6, 23, 0.4);
      }
      .card h3 {
        margin: 0;
        font-size: 1rem;
        line-height: 1.4;
      }
      .card a {
        color: #f8fafc;
        text-decoration: none;
      }
      .card a:hover {
        text-decoration: underline;
      }
      .labels {
        display: flex;
        gap: 0.4rem;
        flex-wrap: wrap;
        margin-top: 0.55rem;
      }
      .label {
        font-size: 0.72rem;
        border-radius: 9999px;
        background: #334155;
        color: #cbd5e1;
        padding: 0.18rem 0.52rem;
      }
      .desc {
        margin: 0.72rem 0 0.32rem;
        color: #cbd5e1;
      }
      .why {
        margin: 0.35rem 0;
        color: #f1f5f9;
      }
      .meta {
        margin: 0.35rem 0 0.65rem;
        font-size: 0.78rem;
        color: #94a3b8;
      }
      .add-btn {
        border: 0;
        border-radius: 0.6rem;
        padding: 0.52rem 0.8rem;
        background: #2563eb;
        color: #eff6ff;
        font-weight: 600;
        cursor: pointer;
      }
      .add-btn:hover {
        background: #1d4ed8;
      }
      .add-btn:focus {
        outline: 2px solid #93c5fd;
        outline-offset: 2px;
      }
      .add-btn:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }
      .status {
        margin: 0 0 0.75rem;
        min-height: 1.2rem;
        color: #7dd3fc;
      }
      .empty {
        color: #94a3b8;
        font-style: italic;
      }
    </style>
  </head>
  <body>
    <main>
      <h1 data-testid="triage-board-title">Issue triage board</h1>
      <p class="subhead">Repository: ${escapeHtml(board.repo)}</p>
      <p class="status" role="status" aria-live="polite" data-testid="triage-status" id="status"></p>

      <section class="section" aria-labelledby="top-priority-heading">
        <h2 id="top-priority-heading" class="section-title">Needs attention now (top 3)</h2>
        <div class="cards" data-testid="top-issues">
          ${topIssueCards.length ? topIssueCards.join("") : '<p class="empty">No top-priority issues were provided.</p>'}
        </div>
      </section>

      <section class="section" aria-labelledby="backlog-heading">
        <h2 id="backlog-heading" class="section-title">Remaining open issues</h2>
        <div class="cards-vertical" data-testid="backlog-issues">
          ${backlogCards.length ? backlogCards.join("") : '<p class="empty">No remaining issues.</p>'}
        </div>
      </section>
    </main>
    <script>
      const statusNode = document.getElementById("status");
      const buttons = Array.from(document.querySelectorAll('[data-action="add-context"]'));

      async function addIssueToContext(button) {
        const issueNumber = Number(button.dataset.issueNumber);
        const originalText = button.textContent;
        button.disabled = true;
        button.textContent = "Adding…";
        statusNode.textContent = "";

        const response = await fetch("/api/add-context", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ issueNumber }),
        });

        if (!response.ok) {
          throw new Error("Unable to add this issue to context.");
        }

        const result = await response.json();
        statusNode.textContent = result.message || "Issue added to current context.";
        button.textContent = "Added";

        setTimeout(() => {
          button.disabled = false;
          button.textContent = originalText;
        }, 900);
      }

      for (const button of buttons) {
        button.addEventListener("click", async () => {
          try {
            await addIssueToContext(button);
          } catch (error) {
            statusNode.textContent = error instanceof Error ? error.message : "Unable to add issue to context.";
            button.disabled = false;
            button.textContent = "Add to current context";
          }
        });
      }
    </script>
  </body>
</html>`;
}

async function startServer(instanceId) {
    const server = createServer(async (req, res) => {
        const requestUrl = new URL(req.url || "/", "http://127.0.0.1");

        if (requestUrl.pathname === "/api/add-context" && req.method === "POST") {
            let body = "";
            req.on("data", (chunk) => {
                body += chunk;
            });
            req.on("end", async () => {
                let parsed;
                try {
                    parsed = JSON.parse(body || "{}");
                } catch {
                    res.statusCode = 400;
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.end(JSON.stringify({ message: "Request body must be valid JSON." }));
                    return;
                }
                const issueNumber = Number(parsed.issueNumber);
                const entry = instances.get(instanceId);
                if (!entry) {
                    res.statusCode = 404;
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.end(JSON.stringify({ message: "Canvas instance not found." }));
                    return;
                }

                const selectedIssue = [...entry.board.topIssues, ...entry.board.backlogIssues]
                    .find((issue) => issue.number === issueNumber);

                if (!selectedIssue) {
                    res.statusCode = 404;
                    res.setHeader("Content-Type", "application/json; charset=utf-8");
                    res.end(JSON.stringify({ message: "Issue not found in this board." }));
                    return;
                }

                await session.send({
                    prompt: `${CONTEXT_PROMPT_HEADER}

Repository: ${entry.board.repo}
Issue: #${selectedIssue.number} ${selectedIssue.title}
URL: ${selectedIssue.url}
Summary: ${selectedIssue.description}
Priority rationale: ${selectedIssue.justification || "Selected from triage board."}`,
                });

                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ message: `Added #${selectedIssue.number} to the current session context.` }));
            });
            req.on("error", () => {
                res.statusCode = 400;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.end(JSON.stringify({ message: "Unable to read request body." }));
            });
            return;
        }

        if (requestUrl.pathname !== "/") {
            res.statusCode = 404;
            res.end("Not found");
            return;
        }

        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderHtml(instanceId));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return { server, url: `http://127.0.0.1:${port}/` };
}

const session = await joinSession({
    canvases: [
        createCanvas({
            id: "issue-triage-board",
            displayName: "Issue triage board",
            description: "Kanban-style issue board with top-priority triage and quick add-to-context buttons.",
            inputSchema: {
                type: "object",
                properties: {
                    repo: {
                        type: "string",
                        description: "Repository name in owner/repo format.",
                    },
                    topIssues: {
                        type: "array",
                        description: "Top three issues requiring immediate attention.",
                        items: {
                            type: "object",
                            properties: {
                                number: { type: "number" },
                                title: { type: "string" },
                                url: { type: "string" },
                                description: { type: "string" },
                                justification: { type: "string" },
                                labels: { type: "array", items: { type: "string" } },
                                updatedAt: { type: "string" },
                            },
                            required: ["number", "title", "url", "description", "justification"],
                        },
                    },
                    backlogIssues: {
                        type: "array",
                        description: "All remaining open issues in the backlog section.",
                        items: {
                            type: "object",
                            properties: {
                                number: { type: "number" },
                                title: { type: "string" },
                                url: { type: "string" },
                                description: { type: "string" },
                                justification: { type: "string" },
                                labels: { type: "array", items: { type: "string" } },
                                updatedAt: { type: "string" },
                            },
                            required: ["number", "title", "url", "description"],
                        },
                    },
                },
                required: ["repo", "topIssues", "backlogIssues"],
            },
            actions: [
                {
                    name: "refresh_board_data",
                    description: "Updates board data for the open canvas instance.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            repo: { type: "string" },
                            topIssues: { type: "array" },
                            backlogIssues: { type: "array" },
                        },
                        required: ["repo", "topIssues", "backlogIssues"],
                    },
                    handler: async (ctx) => {
                        const entry = instances.get(ctx.instanceId);
                        if (!entry) {
                            throw new Error("Canvas instance is not open.");
                        }
                        entry.board = normalizeBoardInput(ctx.input);
                        return {
                            ok: true,
                            message: "Board data refreshed.",
                            counts: {
                                topIssues: entry.board.topIssues.length,
                                backlogIssues: entry.board.backlogIssues.length,
                            },
                        };
                    },
                },
            ],
            open: async (ctx) => {
                let entry = instances.get(ctx.instanceId);
                if (!entry) {
                    entry = await startServer(ctx.instanceId);
                    entry.board = normalizeBoardInput(ctx.input);
                    instances.set(ctx.instanceId, entry);
                } else {
                    entry.board = normalizeBoardInput(ctx.input);
                }
                return {
                    title: "Issue triage board",
                    url: entry.url,
                    status: `${entry.board.topIssues.length} now • ${entry.board.backlogIssues.length} remaining`,
                };
            },
            onClose: async (ctx) => {
                const entry = instances.get(ctx.instanceId);
                if (entry) {
                    instances.delete(ctx.instanceId);
                    await new Promise((resolve) => entry.server.close(() => resolve()));
                }
            },
        }),
    ],
});
