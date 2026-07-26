import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("superAdminPassword", () => {
  const original = process.env.SUPER_ADMIN_PASSWORD;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (original === undefined) delete process.env.SUPER_ADMIN_PASSWORD;
    else process.env.SUPER_ADMIN_PASSWORD = original;
    vi.resetModules();
  });

  it("detects Super Admin demo targets by email or role", async () => {
    process.env.SUPER_ADMIN_PASSWORD = "secret";
    const { isSuperAdminDemoTarget } = await import("../superAdminPassword.js");
    expect(isSuperAdminDemoTarget("admin@ops-demo.local", [])).toBe(true);
    expect(isSuperAdminDemoTarget("Admin@OPS-Demo.Local", [])).toBe(true);
    expect(isSuperAdminDemoTarget("ops@ops-demo.local", ["SUPER_ADMIN"])).toBe(true);
    expect(isSuperAdminDemoTarget("ops@ops-demo.local", ["OPS_MANAGER"])).toBe(false);
  });

  it("rejects when password is unset", async () => {
    delete process.env.SUPER_ADMIN_PASSWORD;
    const mod = await import("../superAdminPassword.js");
    expect(mod.isSuperAdminPasswordConfigured()).toBe(false);
    expect(mod.verifySuperAdminPassword("anything")).toBe(false);
  });

  it("accepts the configured password and rejects wrong ones", async () => {
    process.env.SUPER_ADMIN_PASSWORD = "correct-horse-battery";
    const { isSuperAdminPasswordConfigured, verifySuperAdminPassword } =
      await import("../superAdminPassword.js");
    expect(isSuperAdminPasswordConfigured()).toBe(true);
    expect(verifySuperAdminPassword("correct-horse-battery")).toBe(true);
    expect(verifySuperAdminPassword("  correct-horse-battery  ")).toBe(true);
    expect(verifySuperAdminPassword("wrong")).toBe(false);
    expect(verifySuperAdminPassword(undefined)).toBe(false);
    expect(verifySuperAdminPassword("")).toBe(false);
    expect(verifySuperAdminPassword("   ")).toBe(false);
  });

  it("treats quoted env secrets as unquoted after env normalization", async () => {
    process.env.SUPER_ADMIN_PASSWORD = '"quoted-secret"';
    const { verifySuperAdminPassword } = await import("../superAdminPassword.js");
    expect(verifySuperAdminPassword("quoted-secret")).toBe(true);
    expect(verifySuperAdminPassword('"quoted-secret"')).toBe(false);
  });
});
