import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readAdminAccessDenial } from "./admin-access";

void describe("admin access denials", () => {
  void it("distinguishes missing MFA, an expired check, and a missing admin role", async () => {
    assert.equal(
      await readAdminAccessDenial(Response.json({ error: "ADMIN_MFA_REQUIRED" }, { status: 403 })),
      "mfa_required",
    );
    assert.equal(
      await readAdminAccessDenial(
        Response.json({ error: "ADMIN_REAUTHENTICATION_REQUIRED" }, { status: 403 }),
      ),
      "reauthentication_required",
    );
    assert.equal(
      await readAdminAccessDenial(Response.json({ error: "ADMIN_REQUIRED" }, { status: 403 })),
      "not_admin",
    );
    assert.equal(
      await readAdminAccessDenial(new Response("not json", { status: 403 })),
      "not_admin",
    );
    assert.equal(await readAdminAccessDenial(Response.json({}, { status: 200 })), null);
  });
});
