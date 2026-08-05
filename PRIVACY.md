# Privacy and Network Communication

Lantern is designed with privacy in mind:

- **Localhost-Only Communication**: The application runs a web client and API server on localhost, communicating exclusively between your browser and the local server
- **Reads Local Logs Only**: Session history is read from the directories the agent CLIs already write to on this machine — Claude Code, Codex CLI and opencode. Lantern sends none of it anywhere
- **Provider Access Is Delegated**: Lantern contacts no model provider itself. When you start or resume a session, it invokes the CLI you chose and that CLI talks to its own provider — Claude Code to the Anthropic API via the Claude Agent SDK, and likewise for the others. No other external services are contacted
- **No Tracking or Telemetry**: The application does not collect crash reports, usage statistics, or any other telemetry. Whatever telemetry each agent CLI does follows that CLI's own configuration, not Lantern's
- **Network Isolation**: The application functions correctly even if network access is restricted to the localhost port and whichever provider endpoints your enabled CLIs need. There are no plans to add external network dependencies in the future

If you have concerns about network access, you can verify that the application only communicates with localhost and the providers your own CLIs use by monitoring network traffic.
