import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  hashInviteToken,
  type IntegrationClient,
  integrationTest,
  makeIntegrationSlug,
  requireIntegrationEnv,
} from "./helpers/supabaseIntegration.js";

const client = requireIntegrationEnv();

test("integration harness is disabled unless RUN_SUPABASE_INTEGRATION=1", async (t) => {
  if (client) {
    t.skip("Integration mode is enabled.");
  }

  assert.equal(process.env.RUN_SUPABASE_INTEGRATION === "1", false);
});

const createInvitationSmoke = integrationTest(
  "service-role can create and clean up an organization invite in a disposable org",
  async (supabase: IntegrationClient) => {
    const slug = makeIntegrationSlug("codex-int");
    const userId = randomUUID();
    const inviteToken = randomUUID();

    const { data: organization, error: organizationError } = await supabase
      .from("organizations")
      .insert({
        name: `Codex Integration ${slug}`,
        slug,
        is_active: true,
      })
      .select("id, slug")
      .single();

    assert.ifError(organizationError);
    assert.ok(organization?.id);

    try {
      const { error: membershipError } = await supabase.from("organization_users").insert({
        organization_id: organization.id,
        user_id: userId,
        role: "admin",
        is_active: true,
      });

      assert.ifError(membershipError);

      const { data: invite, error: inviteError } = await supabase
        .from("organization_invitations")
        .insert({
          organization_id: organization.id,
          email: `${slug}@example.com`,
          full_name: "Codex Integration",
          role: "admin",
          invited_by_user_id: userId,
          token_hash: hashInviteToken(inviteToken),
          status: "pending",
          expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        })
        .select("id, organization_id, email, role, status")
        .single();

      assert.ifError(inviteError);
      assert.equal(invite?.organization_id, organization.id);
      assert.equal(invite?.role, "admin");
      assert.equal(invite?.status, "pending");
    } finally {
      await supabase.from("organization_invitations").delete().eq("organization_id", organization.id);
      await supabase.from("organization_users").delete().eq("organization_id", organization.id);
      await supabase.from("organizations").delete().eq("id", organization.id);
    }
  }
);

test(createInvitationSmoke.name, async (t) => {
  if (!createInvitationSmoke.enabled || !client) {
    t.skip("Set RUN_SUPABASE_INTEGRATION=1 to run Supabase-backed smoke tests.");
    return;
  }

  await createInvitationSmoke.fn(client);
});
