/** Owners and admins may delete conversations. Better Auth roles can be a comma list, e.g. "owner,admin". */
export const canDeleteConversations = (role: string) =>
  role.split(",").some((r) => {
    const x = r.trim();
    return x === "owner" || x === "admin";
  });
