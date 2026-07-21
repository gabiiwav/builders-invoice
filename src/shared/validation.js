export function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

export function validateDocumentInput(document) {
  const errors = {};
  if (!String(document.clientName || '').trim()) errors.clientName = 'Client name is required';
  if (!isValidEmail(document.clientEmail)) errors.clientEmail = 'A valid client email is required';
  if (!String(document.jobDescription || document.jobDesc || '').trim()) errors.jobDescription = 'Job description is required';
  if (!(document.items || []).some(item => (Number(item.qty ?? item.quantity) || 0) > 0 && (Number(item.rate) || 0) > 0)) {
    errors.items = 'At least one line item with a quantity and rate is required';
  }
  return { valid: Object.keys(errors).length === 0, errors };
}
