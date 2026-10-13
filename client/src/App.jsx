import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useAuth } from './lib/auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import ProviderDashboard from './pages/ProviderDashboard.jsx';
import ListingForm from './pages/ListingForm.jsx';
import ListingDetail from './pages/ListingDetail.jsx';
import RecipientInbox from './pages/RecipientInbox.jsx';
import RecipientTasks from './pages/RecipientTasks.jsx';
import VolunteerAvailable from './pages/VolunteerAvailable.jsx';
import VolunteerTasks from './pages/VolunteerTasks.jsx';
import TaskDetail from './pages/TaskDetail.jsx';
import Impact from './pages/Impact.jsx';
import Notifications from './pages/Notifications.jsx';
import Carriers from './pages/Carriers.jsx';

function Protected() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-navy-700">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

function Home() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  const dest = user.role === 'provider' ? '/provider' : user.role === 'recipient' ? '/inbox' : '/volunteer';
  return <Navigate to={dest} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<Protected />}>
        <Route path="/" element={<Home />} />
        <Route path="/provider" element={<ProviderDashboard />} />
        <Route path="/listings/new" element={<ListingForm />} />
        <Route path="/listings/:id" element={<ListingDetail />} />
        <Route path="/listings/:id/edit" element={<ListingForm />} />
        <Route path="/inbox" element={<RecipientInbox />} />
        <Route path="/recipient" element={<RecipientTasks />} />
        <Route path="/volunteer" element={<VolunteerAvailable />} />
        <Route path="/my-tasks" element={<VolunteerTasks />} />
        <Route path="/tasks/:id" element={<TaskDetail />} />
        <Route path="/volunteers" element={<Carriers />} />
        <Route path="/impact" element={<Impact />} />
        <Route path="/notifications" element={<Notifications />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
