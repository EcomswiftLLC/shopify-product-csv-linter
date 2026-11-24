'use strict';

/** True when `digits` (8, 12, 13 or 14 digits) has a valid GS1 check digit. */
function isValidGtin(digits) {
  if (!/^\d+$/.test(digits) || ![8, 12, 13, 14].includes(digits.length)) return false;
  const body = digits.slice(0, -1);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const fromRight = body.length - i; // 1 for the digit next to the check digit
    sum += Number(body[i]) * (fromRight % 2 === 1 ? 3 : 1);
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

module.exports = { isValidGtin };
