import DevGuideExplorer from "./DevGuideExplorer";

function App() {
  return (
    <div style={{ padding: 20, display: "grid", gap: 16 }}>
      <h1 style={{ margin: 0 }}>React Codebase RAG Demo</h1>
      <p style={{ color: "#6b7280", margin: 0 }}>
        Pointed at <code>{import.meta.env.VITE_API_BASE || "http://localhost:3333"}</code>
      </p>
      <DevGuideExplorer />
    </div>
  );
}

export default App;
