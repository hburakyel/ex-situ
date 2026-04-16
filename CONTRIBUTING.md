# Contributing to Ex Situ

Thank you for your interest in Ex Situ — an open-source geospatial index of cultural heritage provenance.

## Ways to Contribute

- **Data**: Submit institution data or provenance records via issue or PR
- **Bug reports**: Open an issue with steps to reproduce
- **Features**: Open an issue first to discuss before submitting a PR
- **Documentation**: Improvements to README, API docs, or inline comments

## Development Setup

### Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 15+ with PostGIS extension

### Frontend

```bash
cd frontend
pnpm install
pnpm dev        # starts at http://localhost:3000
```

### Backend (Strapi)

```bash
cd backend
npm install
npm run develop # starts at http://localhost:1337
```

### Environment Variables

Copy `.env.example` to `.env` in both `frontend/` and `backend/` and fill in the required values.

## Pull Request Guidelines

- Keep PRs focused on a single change
- Include a clear description of what and why
- The CI build must pass before merging

## Code of Conduct

Be respectful. This project is about preserving and making accessible the cultural heritage of communities around the world — treat contributors and their perspectives accordingly.

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0 License](LICENSE).
