export function PageHeader({ title, description, eyebrow }) {
  return (
    <header className="page-heading">
      {eyebrow && <p className="page-heading__eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </header>
  );
}
