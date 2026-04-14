import test from "node:test";
import assert from "node:assert/strict";
import { evaluateWorkflowStepAccessRules } from "../src/lib/deals/workflowAccessRules.js";

const DEFAULT_WORKFLOW_SETTINGS = {
  stepEnforcementEnabled: true,
  requireCreditBureauBeforeSubmit: true,
  requireCustomerBeforeIncome: false,
  requireUnderwritingDecisionBeforeVehicle: true,
  allowAdminBypass: true,
  lockCompletedStepsAfterSubmit: false,
  requireManagerApprovalToReopenSubmittedDeals: false,
};

test("workflow access defaults preserve vehicle gating before deal structure", () => {
  const result = evaluateWorkflowStepAccessRules({
    settings: DEFAULT_WORKFLOW_SETTINGS,
    canBypassStepEnforcement: false,
    step: "deal",
    deal: {},
  });

  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.equal(result.redirectTo, "vehicle");
  }
});

test("workflow access honors disabled step enforcement", () => {
  const result = evaluateWorkflowStepAccessRules({
    settings: {
      ...DEFAULT_WORKFLOW_SETTINGS,
      stepEnforcementEnabled: false,
    },
    canBypassStepEnforcement: false,
    step: "deal",
    deal: {},
  });

  assert.equal(result.allowed, true);
});

test("workflow access can lock earlier steps after submit", () => {
  const result = evaluateWorkflowStepAccessRules({
    settings: {
      ...DEFAULT_WORKFLOW_SETTINGS,
      allowAdminBypass: false,
      lockCompletedStepsAfterSubmit: true,
    },
    canBypassStepEnforcement: false,
    step: "vehicle",
    deal: {
      submit_status: "submitted",
      selected_vehicle_id: "veh-1",
    },
    underwriting: {
      decision: "approved",
    },
  });

  assert.equal(result.allowed, false);
  if (!result.allowed) {
    assert.equal(result.redirectTo, "submit");
  }
});

test("workflow access allows configured admin bypass", () => {
  const result = evaluateWorkflowStepAccessRules({
    settings: {
      ...DEFAULT_WORKFLOW_SETTINGS,
      allowAdminBypass: true,
      lockCompletedStepsAfterSubmit: true,
    },
    canBypassStepEnforcement: true,
    step: "vehicle",
    deal: {
      submit_status: "submitted",
    },
  });

  assert.equal(result.allowed, true);
});
