# Riftbound Game Server

## Issue reports

Set `RIFTBOUND_ISSUE_PULL_TOKEN` to a secret of at least 32 characters to
enable issue report intake and local puller access. When the variable is
unset or empty, the issue report endpoints return
`503 {"error":"issue-reports-disabled"}`.

- `POST /api/issue-reports` accepts a public `IssueReportV1` JSON body.
- `GET /api/issue-reports/pending?limit=N` and
  `POST /api/issue-reports/ack` require
  `Authorization: Bearer <RIFTBOUND_ISSUE_PULL_TOKEN>`.

Reports are held only in process memory. The server does not write report
content to disk, and a server restart clears the queue. A queue is bounded to
200 reports and 100 MiB, reports expire after seven days, and no report is
sent to Zira directly.

The client replaces sensitive log field values with the exact string
`[redacted]` and keeps the field names. The server accepts those values in
`clientLog[].data` and `matchLog.entries[].payload` at any depth and rejects
unredacted values. It stops reading report bodies as soon as they exceed
2 MiB.
