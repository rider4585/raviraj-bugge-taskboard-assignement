# Code Review

## 1. Viewer and Non-Member Users Can Update Any Task

- **File/lines:** `src/app/api/tasks/[id]/route.ts:16-37`
- **Category:** Security
- **Severity:** Critical

`PATCH /api/tasks/:id` authenticates the caller but never checks the task's project membership or role before applying `prisma.task.update`. This lets any signed-in user, including a `viewer` or a user from another project, change task title, description, status, assignee, or position. The `DELETE` handler correctly performs this check on lines 49-53, so the same authorization guard should be added to `PATCH` after loading the existing task.

**Recommended fix:** After `existing` is loaded, call `getProjectMembership(user.id, existing.projectId)` and reject missing memberships or roles failing `canEditTasks`. Add regression tests for viewer, non-member, member, and admin PATCH behavior.

**Proof from running app:**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"dev@example.com","password":"password123"}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).token')

curl -i -X PATCH http://localhost:3000/api/tasks/cmpm4pnxc000xhns13l7bfj4n \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"status":"done"}'
```

Observed response:

```http
HTTP/1.1 200 OK
content-type: application/json

{"task":{"id":"cmpm4pnxc000xhns13l7bfj4n","projectId":"cmpm4pnwv0006hns1qqbwc0nm","title":"Update pricing page copy","description":"Detail for: Update pricing page copy","status":"done","assigneeId":null,"createdById":"cmpm4pnwl0000hns1a1j2uo2y","position":5,"createdAt":"2026-05-26T04:22:20.257Z","updatedAt":"2026-05-26T04:56:16.137Z","assignee":null}}
```

## 2. Project Detail API Exposes Password Hashes

- **File/lines:** `src/app/api/projects/[id]/route.ts:25-38`
- **Category:** Security
- **Severity:** Critical

The project detail query uses `owner: true`, `memberships.include.user: true`, `tasks.include.assignee: true`, and `tasks.include.createdBy: true`. In Prisma, `true` returns every scalar field, including `User.passwordHash`, so any project member can receive password hashes for the owner, members, assignees, and task creators. Even hashed passwords are sensitive and materially increase the impact of a response leak or compromised viewer account.

**Recommended fix:** Replace every `User` include with explicit `select: { id: true, name: true, email: true }`. Add an API regression test asserting `passwordHash` and `password_hash` never appear in project detail responses.

## 3. Task Search Uses Interpolated Raw SQL

- **File/lines:** `src/app/api/projects/[id]/tasks/route.ts:25-35`
- **Category:** Security
- **Severity:** High

The `q` parameter is directly interpolated into a `$queryRawUnsafe` SQL string. A project member can inject SQL through the search query, potentially bypassing intended filters, causing errors, or exposing data depending on database permissions and driver behavior. This is especially risky because search endpoints are easy to reach from the UI or curl.

**Recommended fix:** Replace raw SQL with Prisma `findMany` using `OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }]`, or use parameterized `$queryRaw` if raw SQL is unavoidable.

## 4. Task Assignees Are Not Constrained To Project Members

- **File/lines:** `src/schemas/task.ts:10,17`, `src/app/api/projects/[id]/tasks/route.ts:73-82`, `src/app/api/tasks/[id]/route.ts:29-31`
- **Category:** Data Integrity
- **Severity:** Medium

Task create and update accept any `assigneeId` string and write it directly. The database relation only proves that the assignee is a user, not that the user belongs to the task's project, so tasks can be assigned to unrelated users or viewers. This breaks project access expectations and can create confusing or misleading audit data.

**Recommended fix:** When `assigneeId` is provided, verify a `Membership` exists for `{ userId: assigneeId, projectId }` before create/update. Reject non-members with `400` or `403`, and cover member, viewer, and unrelated-user cases in API tests.
