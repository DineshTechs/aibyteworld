import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Spinner } from './components/ui';
import PublicLayout from './layouts/PublicLayout';
import ArticleListPage from './pages/public/ArticleListPage';
import ArticlePage from './pages/public/ArticlePage';
import AuthorPage from './pages/public/AuthorPage';
import ContactPage from './pages/public/ContactPage';
import HomePage from './pages/public/HomePage';
import NotFoundPage from './pages/public/NotFoundPage';
import NewsletterPage from './pages/public/NewsletterPage';
import StaticPage from './pages/public/StaticPage';

// The admin dashboard (and its rich-text editor) is loaded only when needed,
// so public pages download less JavaScript and load faster.
const AdminLayout = lazy(() => import('./layouts/AdminLayout'));
const RequireRole = lazy(() => import('./layouts/AdminLayout').then((m) => ({ default: m.RequireRole })));
const ActivityPage = lazy(() => import('./pages/admin/ActivityPage'));
const AnalyticsPage = lazy(() => import('./pages/admin/AnalyticsPage'));
const AiProvidersPage = lazy(() => import('./pages/admin/ai/AiProvidersPage'));
const AiStudioPage = lazy(() => import('./pages/admin/ai/AiStudioPage'));
const AutopilotPage = lazy(() => import('./pages/admin/ai/AutopilotPage'));
const ResearchHistoryPage = lazy(() => import('./pages/admin/ai/ResearchHistoryPage'));
const ResearchJobPage = lazy(() => import('./pages/admin/ai/ResearchJobPage'));
const ArticleEditorPage = lazy(() => import('./pages/admin/ArticleEditorPage'));
const ArticlesPage = lazy(() => import('./pages/admin/ArticlesPage'));
const LoginPage = lazy(() => import('./pages/admin/LoginPage'));
const MediaPage = lazy(() => import('./pages/admin/MediaPage'));
const OverviewPage = lazy(() => import('./pages/admin/OverviewPage'));
const ProfilePage = lazy(() => import('./pages/admin/ProfilePage'));
const SettingsPage = lazy(() => import('./pages/admin/SettingsPage'));
const TaxonomyPage = lazy(() => import('./pages/admin/TaxonomyPage'));
const TelegramPage = lazy(() => import('./pages/admin/TelegramPage'));
const UsersPage = lazy(() => import('./pages/admin/UsersPage'));
const GrowthPage = lazy(() => import('./pages/admin/GrowthPage'));
const NewsletterAdminPage = lazy(() => import('./pages/admin/NewsletterAdminPage'));
const RefreshPage = lazy(() => import('./pages/admin/RefreshPage'));

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route index element={<HomePage />} />
          <Route path="blog" element={<ArticleListPage mode="all" />} />
          <Route path="blog/:slug" element={<ArticlePage />} />
          <Route path="category/:slug" element={<ArticleListPage mode="category" />} />
          <Route path="tag/:slug" element={<ArticleListPage mode="tag" />} />
          <Route path="author/:id" element={<AuthorPage />} />
          <Route path="search" element={<ArticleListPage mode="search" />} />
          <Route path="about" element={<StaticPage page="about" />} />
          <Route path="contact" element={<ContactPage />} />
          <Route path="privacy" element={<StaticPage page="privacy" />} />
          <Route path="terms" element={<StaticPage page="terms" />} />
          <Route path="newsletter" element={<NewsletterPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Route>

        <Route path="admin/login" element={<LoginPage />} />
        <Route path="admin" element={<AdminLayout />}>
          <Route index element={<OverviewPage />} />
          <Route path="articles" element={<ArticlesPage />} />
          <Route path="articles/new" element={<ArticleEditorPage />} />
          <Route path="articles/:id/edit" element={<ArticleEditorPage />} />
          <Route path="media" element={<MediaPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route element={<RequireRole roles={['admin', 'editor']} />}>
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="categories" element={<TaxonomyPage kind="categories" />} />
            <Route path="tags" element={<TaxonomyPage kind="tags" />} />
            <Route path="ai/studio" element={<AiStudioPage />} />
            <Route path="ai/jobs" element={<ResearchHistoryPage />} />
            <Route path="ai/jobs/:id" element={<ResearchJobPage />} />
            <Route path="refresh" element={<RefreshPage />} />
          </Route>
          <Route element={<RequireRole roles={['admin']} />}>
            <Route path="settings" element={<SettingsPage />} />
            <Route path="ai/providers" element={<AiProvidersPage />} />
            <Route path="ai/autopilot" element={<AutopilotPage />} />
            <Route path="telegram" element={<TelegramPage />} />
            <Route path="growth" element={<GrowthPage />} />
            <Route path="newsletter" element={<NewsletterAdminPage />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="activity" element={<ActivityPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
