/* Staff logins use @ec.com addresses and are made by E&C, never through the pickup app's sign-up.
   The pickup app refuses @ec.com sign-ups on the page, but Firebase's public sign-up would still take them,
   and several database rules give access by @ec.com email. blockStaffEmailSignUp (index.js) runs before
   any new login is saved and refuses an @ec.com one unless it was allowed first at
   config/ec_signup_allow/<email key> = true (set in the Firebase console, for a login made there). */
'use strict';

const isStaffEmail = (email) => /@ec\.com$/i.test(String(email || '').trim());
// The same key the timeclock rules use: lower case, the first "." turned into ","
const emailKey = (email) => String(email || '').trim().toLowerCase().replace('.', ',');

/** Why a new login is refused, or null to let it through. */
function signUpRefusal(email, allowed) {
  if (!isStaffEmail(email)) return null;
  if (allowed === true) return null;
  return 'Staff logins are made by E&C. Use your own email address.';
}

module.exports = { isStaffEmail, emailKey, signUpRefusal };
