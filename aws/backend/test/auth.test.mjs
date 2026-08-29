import test from "node:test";
import assert from "node:assert/strict";

process.env.USERS_TABLE = "Users";
const { authenticatedUser, requireOffice, requireRole, ROLES } = await import("../src/lib/auth.mjs");

const event = {
  requestContext: { authorizer: { jwt: { claims: { sub: "abc", email: "ADMIN@UST.EDU.PH" } } } }
};
const repo = {
  async get(table, key) {
    assert.equal(table, "Users");
    assert.deepEqual(key, { email: "admin@ust.edu.ph" });
    return { email: key.email, name: "Admin", office: "Simbahayan", role: ROLES.officeAdmin, status: "Active" };
  }
};

test("loads the authenticated Reservata user from an SSO email claim", async () => {
  const user = await authenticatedUser(event, repo);
  assert.equal(user.email, "admin@ust.edu.ph");
  assert.equal(user.subject, "abc");
});

test("enforces role and office ownership", async () => {
  const user = await authenticatedUser(event, repo);
  assert.doesNotThrow(() => requireRole(user, ROLES.officeAdmin));
  assert.throws(() => requireRole(user, ROLES.superAdmin), /not permitted/);
  assert.doesNotThrow(() => requireOffice(user, { office: "Simbahayan" }));
  assert.throws(() => requireOffice(user, { office: "EdTech" }), /assigned to this request/);
});
