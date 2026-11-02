import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="mx-auto max-w-md p-8 text-center">
      <p className="text-4xl">🧺</p>
      <h1 className="mt-3 text-lg font-bold">Page not found</h1>
      <p className="mt-1 text-sm text-slate-500">The link may be wrong or the order is no longer available.</p>
      <Link to="/orders" className="btn-primary mt-4 inline-flex">
        Go to orders
      </Link>
    </div>
  );
}
