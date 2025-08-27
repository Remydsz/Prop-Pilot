import { useEffect, useMemo, useState } from "react";

type SearchResult = {
  name: string;
  file: string;
  score: number;
  preview: string;
};

type SearchResponse = {
  query: string;
  count: number;
  results: SearchResult[];
};

type AnswerUsed = { name: string; file: string; score: number };
type AnswerResponse = {
  query: string;
  scope: string;
  used: AnswerUsed[];
  answer: string;
};

const API = import.meta.env.VITE_API_BASE || "http://localhost:3333";

export default function DevGuideExplorer() {
  const [query, setQuery] = useState("basic link navigation");
  const [scope, setScope] = useState<"all" | "examples" | "src">("examples");
  const [topK, setTopK] = useState(5);

  const [searching, setSearching] = useState(false);
  const [answering, setAnswering] = useState(false);

  const [results, setResults] = useState<SearchResult[]>([]);
  const [answer, setAnswer] = useState<string>("");
  const [used, setUsed] = useState<AnswerUsed[]>([]);
  const [error, setError] = useState<string>("");

  const searchUrl = useMemo(() => {
    const u = new URL(`${API}/search`);
    u.searchParams.set("q", query);
    u.searchParams.set("scope", scope);
    u.searchParams.set("topK", String(topK));
    return u.toString();
  }, [API, query, scope, topK]);

  const answerUrl = useMemo(() => {
    const u = new URL(`${API}/answer`);
    u.searchParams.set("q", query);
    u.searchParams.set("scope", scope);
    u.searchParams.set("topK", String(Math.min(topK, 8)));
    return u.toString();
  }, [API, query, scope, topK]);

  async function doSearch() {
    try {
      setError("");
      setAnswer("");
      setUsed([]);
      setSearching(true);
      const res = await fetch(searchUrl);
      if (!res.ok) throw new Error(`Search failed: ${res.statusText}`);
      const json: SearchResponse = await res.json();
      setResults(json.results);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setSearching(false);
    }
  }

  async function doAnswer() {
    try {
      setError("");
      setAnswer("");
      setUsed([]);
      setAnswering(true);
      const res = await fetch(answerUrl);
      if (!res.ok) throw new Error(`Answer failed: ${res.statusText}`);
      const json: AnswerResponse = await res.json();
      setAnswer(json.answer);
      setUsed(json.used || []);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setAnswering(false);
    }
  }

  useEffect(() => {
    // initial search demo
    doSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 1000 }}>
      <section style={{
        display: "grid",
        gap: 8,
        padding: 12,
        border: "1px solid #e5e7eb",
        borderRadius: 12
      }}>
        <h2 style={{ margin: 0 }}>Developer Guide Explorer</h2>

        <label style={{ display: "grid", gap: 6 }}>
          <span>Query</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. programmatic navigation with useNavigate"
            style={{ padding: 8, borderRadius: 8, border: "1px solid #d1d5db" }}
          />
        </label>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <label>
            Scope:&nbsp;
            <select value={scope} onChange={(e) => setScope(e.target.value as any)}>
              <option value="all">all</option>
              <option value="examples">examples</option>
              <option value="src">src</option>
            </select>
          </label>

          <label>
            topK:&nbsp;
            <input
              type="number"
              min={1}
              max={50}
              value={topK}
              onChange={(e) => setTopK(Number(e.target.value))}
              style={{ width: 80 }}
            />
          </label>

          <button onClick={doSearch} disabled={searching} style={btnStyle}>
            {searching ? "Searching…" : "Search"}
          </button>
          <button onClick={doAnswer} disabled={answering} style={btnPrimary}>
            {answering ? "Generating…" : "Answer with Context"}
          </button>
        </div>

        {error && <p style={{ color: "crimson" }}>{error}</p>}
      </section>

      <section style={{ display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Results</h3>
        {results.length === 0 ? (
          <p style={{ color: "#6b7280" }}>No results yet.</p>
        ) : (
          <ol style={{ display: "grid", gap: 12, paddingLeft: 18 }}>
            {results.map((r) => (
              <li key={`${r.file}#${r.name}`}>
                <div
                  style={{
                    border: "1px solid #e5e7eb",
                    borderRadius: 10,
                    padding: 10,
                    display: "grid",
                    gap: 6,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{r.name}</div>
                  <div style={{ fontFamily: "monospace", fontSize: 12, color: "#6b7280" }}>
                    {r.file}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    score: {r.score.toFixed(3)}
                  </div>
                  <pre style={preStyle}>{r.preview}</pre>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section style={{ display: "grid", gap: 8 }}>
        <h3 style={{ margin: 0 }}>Answer</h3>
        {answer ? (
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 10,
              padding: 12,
              whiteSpace: "pre-wrap",
            }}
          >
            {answer}
            {used?.length > 0 && (
              <>
                <hr />
                <div style={{ fontSize: 12, color: "#6b7280" }}>
                  Context used:
                  <ul>
                    {used.map((u) => (
                      <li key={`${u.file}#${u.name}`}>
                        {u.name} — {u.file} ({u.score.toFixed(3)})
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        ) : (
          <p style={{ color: "#6b7280" }}>Click “Answer with Context”.</p>
        )}
      </section>
    </div>
  );
}

const preStyle: React.CSSProperties = {
  background: "#0b1020",
  color: "#f8fafc",
  padding: 10,
  borderRadius: 8,
  overflowX: "auto",
  margin: 0,
  fontSize: 12,
};

const btnStyle: React.CSSProperties = {
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid #d1d5db",
  background: "#fff",
  cursor: "pointer",
};

const btnPrimary: React.CSSProperties = {
  ...btnStyle,
  background: "#1f2937",
  color: "#fff",
  border: "1px solid #111827",
};
