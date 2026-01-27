// Minimal 404 page without any external components to avoid SSG issues
export default function NotFoundPage() {
	return (
		<html>
			<head>
				<title>404 | Hanzo</title>
			</head>
			<body style={{
				fontFamily: 'system-ui, -apple-system, sans-serif',
				display: 'flex',
				justifyContent: 'center',
				alignItems: 'center',
				minHeight: '100vh',
				margin: 0,
				backgroundColor: '#000',
				color: '#fff',
			}}>
				<div style={{ textAlign: 'center' }}>
					<h1 style={{ fontSize: '8rem', margin: 0, fontWeight: 'bold' }}>
						404
					</h1>
					<p style={{ color: '#888', marginTop: '1rem' }}>
						Sorry, we couldn't find your page.
					</p>
					<a
						href="/dashboard/projects"
						style={{
							display: 'inline-block',
							marginTop: '2rem',
							padding: '0.75rem 1.5rem',
							backgroundColor: '#333',
							color: '#fff',
							borderRadius: '0.5rem',
							textDecoration: 'none',
						}}
					>
						Go to homepage
					</a>
				</div>
			</body>
		</html>
	);
}
