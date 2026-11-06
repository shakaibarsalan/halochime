/** Owners and admins may change integrations (identity secret, actions). Better Auth roles can be "owner,admin". */
export const canManageIntegrations = (role: string) =>
  role.split(",").some((r) => {
    const x = r.trim();
    return x === "owner" || x === "admin";
  });

/** Only owners may create or delete cloned brand voices (a person's voice, and a platform cost). */
export const isOwner = (role: string) => role.split(",").some((r) => r.trim() === "owner");
