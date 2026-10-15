# Event Reminder Notifications

## Overview

The `EventReminderService` provides scheduled, idempotent reminder notifications for upcoming published events.

## Operation & Idempotency

- **Schedule**: Scans published events every 5 minutes.
- **Window**: Selects events starting within the next 24 hours (`startsAt >= now` and `startsAt <= now + 24h`).
- **Idempotency Guarantee**:
  - Reminders sent to users are tracked in the `EventReminder` table.
  - A database unique constraint `@@unique([eventId, userId])` guarantees that duplicate reminders are never delivered, even across concurrent job runs or application restarts.
