import { Link } from 'react-router-dom';
import { Seo } from '../../components/Seo';

export default function NotFoundPage() {
  return (
    <div className="container-page py-24 text-center">
      <Seo title="Page not found" noindex />
      <p className="font-serif text-7xl font-bold text-brand-600">404</p>
      <h1 className="mt-4 text-3xl font-semibold text-stone-900 dark:text-stone-50">Page not found</h1>
      <p className="mt-3 text-stone-500">The page you are looking for doesn’t exist or has been moved.</p>
      <div className="mt-8 flex justify-center gap-3">
        <Link to="/" className="btn btn-primary">
          Go to homepage
        </Link>
        <Link to="/blog" className="btn">
          Browse articles
        </Link>
      </div>
    </div>
  );
}
