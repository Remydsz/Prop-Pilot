# React Codebase RAG

A developer guide explorer that uses **retrieval-augmented generation (RAG)** over a React codebase.  
You can search for components, view their code, and ask natural language questions (“How do I use `NavLink` for active styles?”) to get contextual answers.  

<img width="1026" height="693" alt="Screenshot 2025-08-27 at 3 32 47 AM" src="https://github.com/user-attachments/assets/f97370bb-0b55-4196-a65c-d247cc3ff84c" />

---

## Features

- Indexes any React repo (tested with [React Router](https://github.com/remix-run/react-router))  
- Embedding search powered by [Ollama](https://ollama.com) + local embedding model (`nomic-embed-text`)  
- Natural-language answers via a lightweight LLM (`phi3:mini` or `llama3`)  
- REST API with `/search`, `/component`, `/answer` endpoints  
- Simple Vite + React frontend (`DevGuideExplorer`)  

---

## Setup

### 1. Clone & Install
```bash
git clone <this-repo>
cd react-codebase-rag
npm install
```

### Usage
To index a codebase, use ```npm run ingest```. This parses files under SCAN_ROOT, extracts React components, embeds them, and saves to data/index.json.

Now, start the API server with ```npm run dev:api``` and the frontend with ```npm run dev``` for full functionality.

### Performance
I did not want to pay for API calls, so the example uses Ollama's local embedding model (`nomic-embed-text`) and lightweight LLM (`phi3:mini` or `llama3`) - naturally, performance could be much better with paid options.
