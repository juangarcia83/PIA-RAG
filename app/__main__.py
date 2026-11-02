"""python -m app [--host 127.0.0.1] [--port 8000]   (equivale a python run.py)"""
import argparse

import uvicorn


def main() -> None:
    ap = argparse.ArgumentParser(description="RAG Lab · DOGV")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    uvicorn.run("app.server:app", host=args.host, port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
