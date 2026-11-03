/** Owners and admins may ask for voice minutes. Better Auth roles can be a comma list, e.g. "owner,admin". */
export const canRequestMinutes = (role: string) =>
  role.split(",").some((r) => {
    const x = r.trim();
    return x === "owner" || x === "admin";
  });

/** Choices on the request form. Any whole number in [MIN, MAX] is also allowed as "custom". */
export const MINUTE_PRESETS = [60, 300, 1000] as const;
export const MIN_REQUEST_MINUTES = 30;
export const MAX_REQUEST_MINUTES = 10_000;
export const NOTE_MAX = 500;
