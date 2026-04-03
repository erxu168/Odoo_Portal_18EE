import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';

export default function TasksLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = getCurrentUser();
  if (!user) redirect('/login');

  return (
    <div className="tasks-shell min-h-screen bg-gray-50">
      {children}
    </div>
  );
}
