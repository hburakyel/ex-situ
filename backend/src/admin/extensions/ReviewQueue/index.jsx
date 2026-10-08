import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Stack,
  Typography,
  TextInput,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Alert,
} from '@strapi/design-system';
import { useFetchClient, useNotification } from '@strapi/helper-plugin';

const SITE = 'https://exsitu.app';
const REASONS = ['all', 'desk reviewed', 'flagged', 'country centroid'];

// "40.43, 29.72" (as copied from Wikidata, GeoNames or a map) → [40.43, 29.72]
function parseCoords(text) {
  const m = String(text || '').trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]);
  const lng = parseFloat(m[2]);
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat, lng] : null;
}

function mapLink(row) {
  const params = new URLSearchParams();
  if (row.country_en) params.set('place', row.country_en);
  if (row.label && row.label !== row.country_en) params.set('site', row.label);
  return `${SITE}/map?${params.toString()}`;
}

function QueueRow({ row, onResolved }) {
  const [coords, setCoords] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const { put } = useFetchClient();
  const toggleNotification = useNotification();

  const resolve = async (action) => {
    const parsed = action === 'set' ? parseCoords(coords) : null;
    if (action === 'set' && !parsed) {
      toggleNotification({ type: 'warning', message: 'Coordinates as "lat, lng", e.g. 40.43, 29.72' });
      return;
    }
    setBusy(true);
    try {
      const { data } = await put('/api/museum-objects/review-resolve', {
        label: row.label,
        country: row.country_en,
        action,
        latitude: parsed?.[0],
        longitude: parsed?.[1],
        note: note.trim() || undefined,
      });
      toggleNotification({ type: 'success', message: `${row.label}: ${data.updated} records ${action === 'set' ? 'moved' : 'accepted'}` });
      onResolved(row, data.updated);
    } catch {
      toggleNotification({ type: 'warning', message: 'Update failed — check the console' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tr>
      <Td style={{ maxWidth: 260, whiteSpace: 'normal' }}>
        <Typography fontWeight="bold">{row.label}</Typography>
        <Box>
          <Typography variant="pi" textColor="neutral600">
            {(row.raw_names || []).filter((n) => n !== row.label).join(' · ')}
          </Typography>
        </Box>
        <Box>
          <Typography variant="pi" textColor="neutral500">{(row.institutions || []).join(', ')}</Typography>
        </Box>
      </Td>
      <Td><Typography>{row.country_en || '—'}</Typography></Td>
      <Td><Typography>{row.objects}</Typography></Td>
      <Td>
        <Typography variant="pi" textColor={row.reason === 'flagged' ? 'warning600' : 'neutral600'}>{row.reason}</Typography>
        <Box>
          <Typography variant="pi" textColor="neutral500">
            {row.latitude != null ? `${row.latitude}, ${row.longitude}` : 'no coordinates'}
          </Typography>
        </Box>
      </Td>
      <Td style={{ maxWidth: 280, whiteSpace: 'normal' }}>
        <Typography variant="pi" textColor="neutral600" title={row.note || ''}>
          {(row.note || '').slice(0, 160)}{(row.note || '').length > 160 ? '…' : ''}
        </Typography>
      </Td>
      <Td style={{ minWidth: 300 }}>
        <Stack spacing={2}>
          <TextInput
            aria-label="Coordinates"
            name={`coords-${row.label}`}
            placeholder="lat, lng"
            value={coords}
            onChange={(e) => setCoords(e.target.value)}
            size="S"
          />
          <TextInput
            aria-label="Note"
            name={`note-${row.label}`}
            placeholder="Source / note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            size="S"
          />
          <Box style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Button size="S" onClick={() => resolve('set')} loading={busy} disabled={!coords.trim()}>Set</Button>
            <Button size="S" variant="secondary" onClick={() => resolve('accept')} loading={busy}>Keep as is</Button>
            <a href={`https://www.wikidata.org/w/index.php?search=${encodeURIComponent(row.label)}`} target="_blank" rel="noopener noreferrer">Wikidata ↗</a>
            <a href={mapLink(row)} target="_blank" rel="noopener noreferrer">Ex Situ ↗</a>
          </Box>
        </Stack>
      </Td>
    </Tr>
  );
}

const ReviewQueue = () => {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [reason, setReason] = useState('all');
  const [changed, setChanged] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const { get, put } = useFetchClient();
  const toggleNotification = useNotification();

  useEffect(() => {
    get('/api/museum-objects/review-queue')
      .then(({ data }) => setRows(data.data || []))
      .catch(() => setError('Could not load the review queue — check the console'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows || []).filter((r) =>
      (reason === 'all' || r.reason === reason) &&
      (!q || [r.label, r.country_en, ...(r.raw_names || []), ...(r.institutions || [])]
        .some((v) => String(v || '').toLowerCase().includes(q))));
  }, [rows, query, reason]);

  const onResolved = (row, updated) => {
    setRows((cur) => cur.filter((r) => !(r.label === row.label && r.country_en === row.country_en)));
    setChanged((n) => n + updated);
  };

  const refreshViews = async () => {
    setRefreshing(true);
    try {
      await put('/api/museum-objects/refresh-views', {});
      setChanged(0);
      toggleNotification({ type: 'success', message: 'Map data refreshed — arcs update on the next map load' });
    } catch {
      toggleNotification({ type: 'warning', message: 'Refresh failed — check the console' });
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Box padding={8} background="neutral100">
      <Stack spacing={6}>
        <Box style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <Box>
            <Typography variant="alpha">Review</Typography>
            <Box paddingTop={2}>
              <Typography variant="epsilon" textColor="neutral600">
                Places waiting for a person: flagged by the ETL, or still on their country&apos;s centre under a
                label that names somewhere else. "desk reviewed" rows were already decided in a desk review
                (the note says what was moved or kept, and the source) and wait for you to confirm.
                Set writes the coordinates you looked up (Wikidata, GeoNames…) to every record with that
                label; Keep as is accepts the records as they stand. Both mark the records
                verified, so scripts no longer change them. Never guess — leave a row if the place is unclear.
              </Typography>
            </Box>
          </Box>
          <Button onClick={refreshViews} loading={refreshing} variant={changed ? 'default' : 'secondary'} size="S">
            {changed ? `Refresh map data (${changed} changed)` : 'Refresh map data'}
          </Button>
        </Box>

        {error && <Alert variant="danger" title="Error">{error}</Alert>}

        <Box padding={6} background="neutral0" shadow="filterShadow" borderRadius="4px">
          <Stack spacing={4}>
            <Box style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Box style={{ minWidth: 320 }}>
                <TextInput
                  label="Filter"
                  name="filter"
                  placeholder="Place, country, raw name or museum"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </Box>
              {REASONS.map((r) => (
                <Button key={r} size="S" variant={reason === r ? 'default' : 'tertiary'} onClick={() => setReason(r)}>
                  {r}
                </Button>
              ))}
              <Typography variant="pi" textColor="neutral600">
                {rows ? `${shown.length} of ${rows.length} places (largest first, up to 500)` : 'Loading…'}
              </Typography>
            </Box>

            {rows && shown.length > 0 && (
              <Table colCount={6} rowCount={shown.length}>
                <Thead>
                  <Tr>
                    <Th><Typography variant="sigma">Place</Typography></Th>
                    <Th><Typography variant="sigma">Country</Typography></Th>
                    <Th><Typography variant="sigma">Objects</Typography></Th>
                    <Th><Typography variant="sigma">Why</Typography></Th>
                    <Th><Typography variant="sigma">Note</Typography></Th>
                    <Th><Typography variant="sigma">Decision</Typography></Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {shown.slice(0, 200).map((row) => (
                    <QueueRow key={`${row.country_en}|${row.label}`} row={row} onResolved={onResolved} />
                  ))}
                </Tbody>
              </Table>
            )}
            {rows && shown.length > 200 && (
              <Typography variant="pi" textColor="neutral600">Showing the first 200 — narrow the filter to see more.</Typography>
            )}
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
};

export default ReviewQueue;
