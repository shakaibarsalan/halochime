"""``python -m talkfront_agent dev|start|console|connect|download-files``"""

from __future__ import annotations

import sys
import warnings
from pathlib import Path

from dotenv import load_dotenv


def _load_env() -> None:
    # apps/agent/.env (next to pyproject.toml), then a .env in the working directory.
    # Real environment variables always win.
    project_env = Path(__file__).resolve().parents[2] / ".env"
    if project_env.is_file():
        load_dotenv(project_env, override=False)
    load_dotenv(override=False)


def main() -> None:
    _load_env()
    args = sys.argv[1:]

    if args and args[0] == "download-files":
        # Calling download-files through the agent script is deprecated in livekit-agents 1.8;
        # use the library's own command, which imports every installed livekit.plugins.* package.
        from livekit.agents.__main__ import main as livekit_main

        sys.exit(livekit_main(["download-files"]))

    from livekit.agents import cli

    from .agent import server

    # cli.run_app is LiveKit's Python CLI (dev/start/console/connect). It still works in 1.8 but
    # warns that `lk agent dev` is the future entry point; keep our output clean.
    warnings.filterwarnings("ignore", message="the built-in Python CLI is deprecated", category=DeprecationWarning)
    cli.run_app(server)


if __name__ == "__main__":
    main()
