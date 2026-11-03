/** Owners and admins may change integrations (identity secret, actions). Better Auth roles can be "owner,admin". */
export const canManageIntegrations = (role: string) =>
  role.split(",").some((r) => {
    const x = r.trim();
    return x === "owner" || x === "admin";
  });
