function assertUser(getUser) {
  const user = getUser();
  if (!user?.id) throw new Error('Authentication required');
  return user;
}

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

export function createRepositories(supabase, getUser) {
  return {
    quotes: {
      async save(document, items) {
        assertUser(getUser);
        const data = unwrap(await supabase.rpc('save_quote_with_items', { document, items }));
        return data;
      },
    },
    invoices: {
      async save(document, items) {
        assertUser(getUser);
        return unwrap(await supabase.rpc('save_invoice_with_items', { document, items }));
      },
      async markPaid(id) {
        const user = assertUser(getUser);
        return unwrap(await supabase.from('invoices').update({ status: 'Paid' }).eq('id', id).eq('user_id', user.id));
      },
    },
    events: {
      async list(documentType, documentId) {
        const user = assertUser(getUser);
        return unwrap(await supabase.from('document_events').select('*')
          .eq('user_id', user.id).eq('document_type', documentType).eq('document_id', documentId)
          .order('created_at', { ascending: false }));
      },
    },
  };
}
