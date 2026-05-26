import React, { useState, useRef, useEffect } from 'react';
import {
  Box,
  Button,
  Stack,
  Typography,
  TextInput,
  Textarea,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  Alert,
  Grid,
  GridItem,
} from '@strapi/design-system';
import { useFetchClient, useNotification } from '@strapi/helper-plugin';

// ── Autocomplete place-name input ────────────────────────────────────────────
function PlaceAutocomplete({ value, onChange, onSelect }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const { get } = useFetchClient();
  const debounce = useRef(null);
  const wrapperRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    onChange(val);
    clearTimeout(debounce.current);
    if (val.trim().length >= 2) {
      debounce.current = setTimeout(async () => {
        try {
          const { data } = await get(`/api/museum-objects/suggest?q=${encodeURIComponent(val.trim())}&limit=10`);
          setSuggestions(data.data || []);
          setOpen(true);
        } catch {
          setSuggestions([]);
        }
      }, 250);
    } else {
      setSuggestions([]);
      setOpen(false);
    }
  };

  const handleSelect = (s) => {
    onSelect(s.place_name);
    setSuggestions([]);
    setOpen(false);
  };

  return (
    <Box ref={wrapperRef} style={{ position: 'relative' }}>
      <TextInput
        label="Place name"
        value={value}
        onChange={handleChange}
        placeholder="Type to search…"
        name="place_name"
      />
      {open && suggestions.length > 0 && (
        <Box
          background="neutral0"
          shadow="tableShadow"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 9999,
            maxHeight: '260px',
            overflowY: 'auto',
            border: '1px solid #ddd',
            borderRadius: '4px',
          }}
        >
          {suggestions.map((s) => (
            <Box
              key={s.place_name}
              padding={3}
              style={{ cursor: 'pointer' }}
              onMouseDown={() => handleSelect(s)}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#f6f6f9')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <Typography variant="omega" fontWeight="bold">{s.place_name}</Typography>
              {' '}
              <Typography variant="pi" textColor="neutral500">
                {[s.city_en, s.country_en].filter(Boolean).join(', ')} · {s.object_count} artifacts
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function GeoCorrection() {
  const [filter, setFilter] = useState({ place_name: '', institution_name: '' });
  const [form, setForm] = useState({
    place_name_normalized: '',
    city_en: '',
    country_en: '',
    latitude: '',
    longitude: '',
    geocoding_notes: '',
  });
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState(null);

  const { get, put } = useFetchClient();
  const toggleNotification = useNotification();

  const handlePreview = async () => {
    if (!filter.place_name.trim()) {
      toggleNotification({ type: 'warning', message: 'Select or type a place name first' });
      return;
    }
    setLoading(true);
    setPreview(null);
    setResult(null);
    try {
      const params = new URLSearchParams({ place_name: filter.place_name.trim() });
      if (filter.institution_name.trim()) params.set('institution', filter.institution_name.trim());
      const { data } = await get(`/api/museum-objects/lookup?${params.toString()}`);
      setPreview(data);
    } catch {
      toggleNotification({ type: 'warning', message: 'Preview failed — check the console' });
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    const hasUpdates = Object.values(form).some(v => v.trim() !== '');
    if (!hasUpdates) {
      toggleNotification({ type: 'warning', message: 'Fill in at least one correction field' });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const { data } = await put('/api/museum-objects/bulk-geocode', {
        place_name: filter.place_name.trim(),
        institution_name: filter.institution_name.trim() || undefined,
        updates: form,
      });
      setResult(data);
      toggleNotification({ type: 'success', message: `Updated ${data.updatedCount} records` });
    } catch {
      toggleNotification({ type: 'warning', message: 'Update failed — check the console' });
    } finally {
      setLoading(false);
    }
  };

  const handleRefreshViews = async () => {
    setRefreshing(true);
    try {
      await put('/api/museum-objects/refresh-views', {});
      toggleNotification({ type: 'success', message: 'Map data refreshed — arcs will update on next map load' });
    } catch {
      toggleNotification({ type: 'warning', message: 'Refresh failed — check the console' });
    } finally {
      setRefreshing(false);
    }
  };

  const setField = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  return (
    <Box padding={8} background="neutral100">
      <Stack spacing={6}>

        {/* Header */}
        <Box style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Typography variant="alpha">Geo Correction</Typography>
            <Box paddingTop={2}>
              <Typography variant="epsilon" textColor="neutral600">
                Find records by place name and apply bulk geocoding corrections.
              </Typography>
            </Box>
          </Box>
          <Button
            onClick={handleRefreshViews}
            loading={refreshing}
            variant="secondary"
            size="S"
          >
            Refresh map data
          </Button>
        </Box>

        {/* Step 1 */}
        <Box padding={6} background="neutral0" shadow="filterShadow" borderRadius="4px">
          <Stack spacing={4}>
            <Typography variant="delta">Step 1 — Find records</Typography>
            <Grid gap={4}>
              <GridItem col={6} s={12}>
                <PlaceAutocomplete
                  value={filter.place_name}
                  onChange={(val) => setFilter(f => ({ ...f, place_name: val }))}
                  onSelect={(val) => setFilter(f => ({ ...f, place_name: val }))}
                />
              </GridItem>
              <GridItem col={6} s={12}>
                <TextInput
                  label="Institution (optional)"
                  value={filter.institution_name}
                  onChange={(e) => setFilter(f => ({ ...f, institution_name: e.target.value }))}
                  placeholder="e.g. Ethnologisches Museum"
                  name="institution_name"
                />
              </GridItem>
            </Grid>
            <Box>
              <Button onClick={handlePreview} loading={loading} size="L">
                Preview matching records
              </Button>
            </Box>
          </Stack>
        </Box>

        {/* Preview */}
        {preview && (
          <Box padding={6} background="neutral0" shadow="filterShadow" borderRadius="4px">
            <Stack spacing={4}>
              <Typography variant="delta">
                {preview.total === 0
                  ? 'No records found'
                  : `${preview.total} record${preview.total === 1 ? '' : 's'} found`}
              </Typography>
              {preview.sample.length > 0 && (
                <>
                  <Table colCount={5} rowCount={preview.sample.length}>
                    <Thead>
                      <Tr>
                        <Th><Typography variant="sigma">ID</Typography></Th>
                        <Th><Typography variant="sigma">Title</Typography></Th>
                        <Th><Typography variant="sigma">Place</Typography></Th>
                        <Th><Typography variant="sigma">Country</Typography></Th>
                        <Th><Typography variant="sigma">Institution</Typography></Th>
                      </Tr>
                    </Thead>
                    <Tbody>
                      {preview.sample.map(row => (
                        <Tr key={row.id}>
                          <Td><Typography>{row.id}</Typography></Td>
                          <Td><Typography>{String(row.title || '').slice(0, 45)}</Typography></Td>
                          <Td><Typography>{row.place_name}</Typography></Td>
                          <Td><Typography>{row.country_en || '—'}</Typography></Td>
                          <Td><Typography>{row.institution_name}</Typography></Td>
                        </Tr>
                      ))}
                    </Tbody>
                  </Table>
                  {preview.total > 5 && (
                    <Typography variant="pi" textColor="neutral500">
                      Showing first 5 of {preview.total}. All {preview.total} will be updated.
                    </Typography>
                  )}
                </>
              )}
            </Stack>
          </Box>
        )}

        {/* Step 2 */}
        {preview && preview.total > 0 && (
          <Box padding={6} background="neutral0" shadow="filterShadow" borderRadius="4px">
            <Stack spacing={4}>
              <Typography variant="delta">Step 2 — Enter corrections</Typography>
              <Typography variant="omega" textColor="neutral500">
                Leave a field empty to keep the existing value.
              </Typography>
              <Grid gap={4}>
                <GridItem col={6} s={12}>
                  <TextInput
                    label="Place name normalized"
                    value={form.place_name_normalized}
                    onChange={setField('place_name_normalized')}
                    placeholder="e.g. Londini"
                    name="place_name_normalized"
                  />
                </GridItem>
                <GridItem col={6} s={12}>
                  <TextInput
                    label="City (English)"
                    value={form.city_en}
                    onChange={setField('city_en')}
                    placeholder="e.g. Eipomek"
                    name="city_en"
                  />
                </GridItem>
                <GridItem col={6} s={12}>
                  <TextInput
                    label="Country (English)"
                    value={form.country_en}
                    onChange={setField('country_en')}
                    placeholder="e.g. Indonesia"
                    name="country_en"
                  />
                </GridItem>
                <GridItem col={3} s={6}>
                  <TextInput
                    label="Latitude"
                    value={form.latitude}
                    onChange={setField('latitude')}
                    placeholder="-4.4167"
                    name="latitude"
                  />
                </GridItem>
                <GridItem col={3} s={6}>
                  <TextInput
                    label="Longitude"
                    value={form.longitude}
                    onChange={setField('longitude')}
                    placeholder="140.0167"
                    name="longitude"
                  />
                </GridItem>
                <GridItem col={12}>
                  <Textarea
                    label="Geocoding notes"
                    value={form.geocoding_notes}
                    onChange={setField('geocoding_notes')}
                    placeholder="Describe the correction and source…"
                    name="geocoding_notes"
                  />
                </GridItem>
              </Grid>
              <Box>
                <Button
                  onClick={handleApply}
                  loading={loading}
                  variant="danger"
                  size="L"
                >
                  Apply to all {preview.total} record{preview.total === 1 ? '' : 's'}
                </Button>
              </Box>
            </Stack>
          </Box>
        )}

        {result && (
          <Alert
            title="Done"
            variant="success"
            closeLabel="Close"
            onClose={() => setResult(null)}
          >
            {result.updatedCount} record{result.updatedCount === 1 ? '' : 's'} updated.
            {' '}Click <strong>Refresh map data</strong> (top right) to update arcs on the map.
          </Alert>
        )}
      </Stack>
    </Box>
  );
}
