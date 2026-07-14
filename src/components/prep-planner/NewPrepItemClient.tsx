'use client';

import { useSearchParams } from 'next/navigation';
import PrepItemForm, { EMPTY_FORM } from './PrepItemForm';
import { DEFAULT_COMPANY_ID } from './companies';

export default function NewPrepItemClient() {
  const search = useSearchParams();
  const companyId = Number(search.get('companyId')) || DEFAULT_COMPANY_ID;
  return <PrepItemForm mode="create" companyId={companyId} initial={EMPTY_FORM} />;
}
