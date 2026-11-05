/** Accept a local Bangladesh mobile number or an international E.164 number. */
export function normalizeSignupPhone(value: string): string | null {
  const compact = value.trim().replace(/[\s()-]/g, '');
  const international = /^01\d{9}$/.test(compact) ? `+88${compact}`
    : /^8801\d{9}$/.test(compact) ? `+${compact}` : compact;
  return /^\+[1-9]\d{7,14}$/.test(international) ? international : null;
}
