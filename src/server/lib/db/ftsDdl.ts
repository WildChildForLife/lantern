/**
 * The full-text index over conversation messages.
 *
 * FTS5 virtual tables cannot be modelled by drizzle or altered afterwards, so
 * this DDL is executed directly rather than migrated. It lives here because the
 * runtime database and the test database must create byte-identical tables — a
 * drift between the two makes tests pass against an index the app never builds.
 */
export const SESSION_MESSAGES_FTS_DDL = `
  CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(
    session_id UNINDEXED,
    project_id UNINDEXED,
    role UNINDEXED,
    content,
    conversation_index UNINDEXED,
    tokenize='trigram'
  )
`;
