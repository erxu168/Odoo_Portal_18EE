import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';

export default function TasksPage() {
  const user = getCurrentUser();

  if (!user)              redirect('/login');
  if (user.role === 'admin')   redirect('/tasks/admin');
  if (user.role === 'manager') redirect('/tasks/manager');
  redirect('/tasks/staff');
}
