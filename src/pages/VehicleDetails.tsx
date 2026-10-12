import { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Box, Typography, Paper, Avatar, IconButton, Chip, useTheme, Button, Tabs, Tab, TextField,
  MenuItem, Dialog, DialogTitle, DialogContent, DialogActions, Autocomplete, InputAdornment,
} from '@mui/material';
import {
  ArrowBack, LocalShipping, Person, Edit, DeleteOutline, Add, Build, Speed, LocationOn,
  CalendarMonth, VerifiedUser, WarningAmber, ErrorOutline, Description, Search,
} from '@mui/icons-material';
import { useAppContext } from '../context/AppContext';
import { useToast } from '../components/ToastProvider';
import EmptyState from '../components/EmptyState';
import type { VehicleDocument } from '../types';
import { documentStatus, DEFAULT_REMINDER_DAYS, type DocumentStatus } from '../utils/documentStatus';
import { currentOdometer, maintenanceCost, tripIncome, tripsForVehicle } from '../utils/vehicleStats';

const VEHICLE_TYPES = ['Truck', 'Tempo', 'Trailer', 'Tanker', 'Pickup', 'Mini Truck', 'Container'];
const MAINTENANCE_TYPES = [
  'Tyre Change', 'Engine Oil Change', 'General Service', 'Brake Work', 'Battery', 'Clutch',
  'Wheel Alignment', 'Repair',
];
const DOCUMENT_LABELS = ['Insurance', 'PUC', 'Fitness Certificate', 'Permit', 'National Permit', 'Road Tax'];

const todayLocalDateString = () => {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

function statusMeta(status: DocumentStatus) {
  if (status.state === 'expired') {
    return { color: '#F6465D', bg: 'rgba(246,70,93,0.12)', icon: <ErrorOutline sx={{ fontSize: 16 }} />, label: `Expired ${Math.abs(status.daysUntilExpiry)}d ago` };
  }
  if (status.state === 'due-soon') {
    return { color: '#F0B90B', bg: 'rgba(240,185,11,0.12)', icon: <WarningAmber sx={{ fontSize: 16 }} />, label: status.daysUntilExpiry === 0 ? 'Expires today' : `Due in ${status.daysUntilExpiry}d` };
  }
  return { color: '#0ECB81', bg: 'rgba(14,203,129,0.12)', icon: <VerifiedUser sx={{ fontSize: 16 }} />, label: `Valid · ${status.daysUntilExpiry}d left` };
}

const emptyMaintenanceForm = () => ({ type: '', date: todayLocalDateString(), odometer: '', cost: '', notes: '' });
const EMPTY_DOC_FORM = { label: '', expiryDate: '' };

const VehicleDetails = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const toast = useToast();
  const {
    vehicles, trips, drivers, updateVehicle, deleteVehicle,
    addVehicleMaintenance, deleteVehicleMaintenance,
    addVehicleDocument, updateVehicleDocument, deleteVehicleDocument,
  } = useAppContext();

  const vehicle = vehicles.find(v => v.id === id);
  const [tab, setTab] = useState(0);
  const [maintenanceSearch, setMaintenanceSearch] = useState('');

  const [numberDialogOpen, setNumberDialogOpen] = useState(false);
  const [numberDraft, setNumberDraft] = useState('');
  const [typeDraft, setTypeDraft] = useState('');
  const [numberError, setNumberError] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  const [maintenanceForm, setMaintenanceForm] = useState(emptyMaintenanceForm);
  const [maintenanceError, setMaintenanceError] = useState('');

  const [docDialog, setDocDialog] = useState<{ document?: VehicleDocument } | null>(null);
  const [docForm, setDocForm] = useState(EMPTY_DOC_FORM);
  const [docError, setDocError] = useState('');

  const [saving, setSaving] = useState(false);

  const vehicleTrips = useMemo(
    () => (vehicle ? [...tripsForVehicle(vehicle, trips)].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()) : []),
    [vehicle, trips],
  );

  if (!vehicle) {
    return (
      <Box sx={{ textAlign: 'center', py: 6 }}>
        <Typography variant="h4" gutterBottom color="error.main">Vehicle Not Found</Typography>
        <Typography variant="body1" sx={{ mb: 4 }}>This vehicle doesn't exist in your group (or hasn't loaded yet).</Typography>
        <IconButton onClick={() => navigate('/vehicles')} sx={{ bgcolor: 'action.hover' }} aria-label="back">
          <ArrowBack />
        </IconButton>
      </Box>
    );
  }

  const income = tripIncome(vehicleTrips);
  const odometer = currentOdometer(vehicle);
  const spentOnMaintenance = maintenanceCost(vehicle);
  // A driver who was assigned and later deactivated still has to show up as the current value.
  const driverOptions = drivers.filter(d => d.active || d.id === vehicle.assignedDriverId);

  const handleAssignDriver = async (driverId: string) => {
    setAssigning(true);
    try {
      await updateVehicle(vehicle.id, { assignedDriverId: driverId || null });
      toast.success(driverId ? 'Driver assigned.' : 'Driver unassigned.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the driver');
    } finally {
      setAssigning(false);
    }
  };

  const handleSaveNumber = async () => {
    const vehicleNumber = numberDraft.trim();
    if (!vehicleNumber) { setNumberError('Number plate is required'); return; }
    setSaving(true);
    setNumberError('');
    try {
      await updateVehicle(vehicle.id, { vehicleNumber, vehicleType: typeDraft.trim() });
      toast.success('Vehicle updated.');
      setNumberDialogOpen(false);
    } catch (error) {
      setNumberError(error instanceof Error ? error.message : 'Could not update the number plate');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteVehicle = async () => {
    setSaving(true);
    try {
      await deleteVehicle(vehicle.id);
      toast.success('Vehicle removed.');
      navigate('/vehicles');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove vehicle');
      setSaving(false);
    }
  };

  const openMaintenance = () => {
    setMaintenanceForm(emptyMaintenanceForm());
    setMaintenanceError('');
    setMaintenanceOpen(true);
  };

  const handleSaveMaintenance = async () => {
    const type = maintenanceForm.type.trim();
    if (!type) { setMaintenanceError('Say what was done (e.g. Tyre Change)'); return; }
    if (!maintenanceForm.date) { setMaintenanceError('Date is required'); return; }
    const odometerText = maintenanceForm.odometer.trim();
    const odometerValue = odometerText ? Number(odometerText) : undefined;
    if (odometerValue !== undefined && (!Number.isFinite(odometerValue) || odometerValue < 0)) {
      setMaintenanceError('Enter a valid odometer reading');
      return;
    }
    const cost = Number(maintenanceForm.cost) || 0;
    if (cost < 0) { setMaintenanceError('Cost cannot be negative'); return; }

    setSaving(true);
    setMaintenanceError('');
    try {
      await addVehicleMaintenance(vehicle.id, {
        type, date: maintenanceForm.date, odometer: odometerValue, cost, notes: maintenanceForm.notes.trim(),
      });
      toast.success('Maintenance entry added.');
      setMaintenanceOpen(false);
    } catch (error) {
      setMaintenanceError(error instanceof Error ? error.message : 'Could not save the entry');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteMaintenance = async (maintenanceId: string) => {
    try {
      await deleteVehicleMaintenance(vehicle.id, maintenanceId);
      toast.success('Maintenance entry removed.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove the entry');
    }
  };

  const openDocument = (document?: VehicleDocument) => {
    setDocForm(document ? { label: document.label, expiryDate: document.expiryDate.slice(0, 10) } : EMPTY_DOC_FORM);
    setDocError('');
    setDocDialog({ document });
  };

  const handleSaveDocument = async () => {
    if (!docDialog) return;
    const label = docForm.label.trim();
    if (!label) { setDocError('Document name is required'); return; }
    if (!docForm.expiryDate) { setDocError('Expiry date is required'); return; }
    setSaving(true);
    setDocError('');
    try {
      if (docDialog.document) {
        await updateVehicleDocument(vehicle.id, docDialog.document.id, { label, expiryDate: docForm.expiryDate });
        toast.success('Document updated.');
      } else {
        await addVehicleDocument(vehicle.id, { label, expiryDate: docForm.expiryDate });
        toast.success('Document added.');
      }
      setDocDialog(null);
    } catch (error) {
      setDocError(error instanceof Error ? error.message : 'Could not save document');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDocument = async (documentId: string) => {
    try {
      await deleteVehicleDocument(vehicle.id, documentId);
      toast.success('Document removed.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not remove document');
    }
  };

  const stats = [
    { label: 'Total Trips', value: String(vehicleTrips.length), accent: '#F0B90B' },
    { label: 'Income Generated', value: `₹${income.toFixed(2)}`, accent: '#0ECB81' },
    { label: 'Odometer', value: odometer !== undefined ? `${odometer.toLocaleString('en-IN')} km` : '—', accent: theme.palette.divider },
    { label: 'Maintenance Cost', value: `₹${spentOnMaintenance.toFixed(2)}`, accent: '#F6465D' },
  ];

  const rowSx = {
    p: 2, borderRadius: 2, border: `1px solid ${theme.palette.divider}`, bgcolor: 'action.hover',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5,
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <IconButton onClick={() => navigate('/vehicles')} sx={{ mr: 2, bgcolor: 'action.hover' }} aria-label="back">
          <ArrowBack />
        </IconButton>
        <Typography variant="h4" component="h1" color="primary.dark" sx={{ fontWeight: 800, fontSize: { xs: '1.4rem', sm: '2.125rem' } }}>
          Vehicle Details
        </Typography>
      </Box>

      <Paper elevation={0} sx={{ p: 3, borderRadius: 2, background: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
          <Avatar sx={{ bgcolor: 'rgba(240, 185, 11, 0.1)', color: '#F0B90B', width: 56, height: 56 }}>
            <LocalShipping />
          </Avatar>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h5" sx={{ fontWeight: 800, color: 'text.primary', letterSpacing: '1px' }}>
              {vehicle.vehicleNumber}
              {vehicle.vehicleType && (
                <Typography component="span" variant="body1" sx={{ ml: 1, color: 'text.secondary', fontWeight: 500 }}>
                  ({vehicle.vehicleType})
                </Typography>
              )}
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {vehicle.assignedDriverName ? `Driven by ${vehicle.assignedDriverName}` : 'No driver assigned'}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="outlined"
              startIcon={<Edit />}
              onClick={() => { setNumberDraft(vehicle.vehicleNumber); setTypeDraft(vehicle.vehicleType || ''); setNumberError(''); setNumberDialogOpen(true); }}
            >
              Edit
            </Button>
            <Button variant="outlined" color="error" startIcon={<DeleteOutline />} onClick={() => setDeleteOpen(true)}>
              Delete
            </Button>
          </Box>
        </Box>
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: { xs: 1.5, sm: 2 } }}>
        {stats.map(stat => (
          <Paper key={stat.label} elevation={0} sx={{ p: 2, borderRadius: 2, border: `1px solid ${theme.palette.divider}`, borderTop: `3px solid ${stat.accent}`, minWidth: 0 }}>
            <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>{stat.label}</Typography>
            <Typography sx={{ fontWeight: 800, fontSize: { xs: '1.1rem', sm: '1.5rem' }, color: 'text.primary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {stat.value}
            </Typography>
          </Paper>
        ))}
      </Box>

      <Paper elevation={0} sx={{ p: 3, borderRadius: 2, border: `1px solid ${theme.palette.divider}` }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Person sx={{ color: '#F0B90B' }} />
          <Typography variant="h6" sx={{ fontWeight: 600, color: 'text.primary' }}>Assigned Driver</Typography>
        </Box>
        <TextField
          select
          fullWidth
          size="small"
          label="Driver"
          value={vehicle.assignedDriverId || ''}
          disabled={assigning}
          onChange={e => handleAssignDriver(e.target.value)}
          sx={{ maxWidth: 360 }}
          helperText={drivers.length === 0 ? 'No drivers have joined your group yet.' : undefined}
        >
          <MenuItem value="">No driver</MenuItem>
          {driverOptions.map(d => (
            <MenuItem key={d.id} value={d.id}>{d.name}{d.active ? '' : ' (inactive)'}</MenuItem>
          ))}
        </TextField>
      </Paper>

      <Paper elevation={0} sx={{ borderRadius: 2, border: `1px solid ${theme.palette.divider}` }}>
        <Tabs value={tab} onChange={(_e, value) => setTab(value)} variant="fullWidth" sx={{ borderBottom: `1px solid ${theme.palette.divider}` }}>
          <Tab label={`Trips (${vehicleTrips.length})`} />
          <Tab label={`Maintenance (${vehicle.maintenance.length})`} />
          <Tab label={`Documents (${vehicle.documents.length})`} />
        </Tabs>

        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          {tab === 0 && (
            vehicleTrips.length === 0 ? (
              <EmptyState
                size="compact"
                icon={<LocalShipping />}
                title="No trips for this vehicle yet"
                description={`Trips count here when their Vehicle Number is ${vehicle.vehicleNumber}.`}
              />
            ) : (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                {vehicleTrips.map(trip => (
                  <Box key={trip.id} sx={rowSx}>
                    <Box sx={{ minWidth: 0 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <LocationOn sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography sx={{ fontWeight: 600, color: 'text.primary', fontSize: 14 }}>
                          {trip.pickupLocation} → {trip.dropLocation}
                        </Typography>
                      </Box>
                      <Typography sx={{ color: 'text.secondary', fontSize: 12, mt: 0.25 }}>
                        {formatDate(trip.date)} · {trip.customerName}{trip.driverName ? ` · ${trip.driverName}` : ''}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0 }}>
                      {trip.status === 'pending' && (
                        <Chip label="Pending" size="small" sx={{ bgcolor: 'rgba(240,185,11,0.12)', color: '#F0B90B', fontWeight: 700 }} />
                      )}
                      <Typography sx={{ fontWeight: 700, color: 'text.primary' }}>₹{Number(trip.amount || 0).toFixed(2)}</Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            )
          )}

          {tab === 1 && (() => {
            const q = maintenanceSearch.toLowerCase().trim();
            const filtered = q
              ? vehicle.maintenance.filter(e =>
                  e.type.toLowerCase().includes(q)
                  || String(e.cost).includes(q)
                  || (e.notes && e.notes.toLowerCase().includes(q)))
              : vehicle.maintenance;
            return (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', gap: 1, justifyContent: 'space-between', flexWrap: 'wrap' }}>
                {vehicle.maintenance.length > 0 && (
                  <TextField
                    size="small"
                    placeholder="Search item, cost, notes…"
                    value={maintenanceSearch}
                    onChange={e => setMaintenanceSearch(e.target.value)}
                    slotProps={{ input: { startAdornment: <InputAdornment position="start"><Search fontSize="small" /></InputAdornment> } }}
                    sx={{ minWidth: 180, flex: 1, maxWidth: 320 }}
                  />
                )}
                <Button variant="contained" startIcon={<Add />} onClick={openMaintenance} sx={{ color: 'primary.contrastText', fontWeight: 700, flexShrink: 0 }}>
                  Add Maintenance
                </Button>
              </Box>
              {vehicle.maintenance.length === 0 ? (
                <EmptyState
                  size="compact"
                  icon={<Build />}
                  title="No maintenance logged yet"
                  description="Record tyre changes, services and repairs with the odometer reading and cost."
                />
              ) : filtered.length === 0 ? (
                <Typography sx={{ color: 'text.secondary', textAlign: 'center', py: 4 }}>No results for "{maintenanceSearch}"</Typography>
              ) : (
                filtered.map(entry => (
                  <Box key={entry.id} sx={rowSx}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 600, color: 'text.primary', fontSize: 14 }}>{entry.type}</Typography>
                      <Box sx={{ display: 'flex', columnGap: 2, rowGap: 0.25, flexWrap: 'wrap', mt: 0.25 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center' }}>
                          <CalendarMonth sx={{ fontSize: 14, mr: 0.5, color: 'text.secondary' }} />
                          <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>{formatDate(entry.date)}</Typography>
                        </Box>
                        {entry.odometer !== undefined && (
                          <Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <Speed sx={{ fontSize: 14, mr: 0.5, color: 'text.secondary' }} />
                            <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>{entry.odometer.toLocaleString('en-IN')} km</Typography>
                          </Box>
                        )}
                      </Box>
                      {entry.notes && (
                        <Typography sx={{ color: 'text.secondary', fontSize: 12, mt: 0.5 }}>{entry.notes}</Typography>
                      )}
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                      <Typography sx={{ fontWeight: 700, color: 'text.primary' }}>₹{Number(entry.cost || 0).toFixed(2)}</Typography>
                      <IconButton size="small" aria-label="remove maintenance entry" onClick={() => handleDeleteMaintenance(entry.id)} sx={{ color: 'text.secondary', '&:hover': { color: '#F6465D' } }}>
                        <DeleteOutline fontSize="small" />
                      </IconButton>
                    </Box>
                  </Box>
                ))
              )}
            </Box>
            );
          })()}

          {tab === 2 && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button variant="contained" startIcon={<Add />} onClick={() => openDocument()} sx={{ color: 'primary.contrastText', fontWeight: 700 }}>
                  Add Document
                </Button>
              </Box>
              {vehicle.documents.length === 0 ? (
                <EmptyState
                  size="compact"
                  icon={<Description />}
                  title="No documents tracked yet"
                  description="Add PUC, insurance, fitness or permit expiry dates to get a reminder before they lapse."
                />
              ) : (
                vehicle.documents.map(document => {
                  const meta = statusMeta(documentStatus(document));
                  return (
                    <Box key={document.id} sx={rowSx}>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 600, color: 'text.primary', fontSize: 14 }}>{document.label}</Typography>
                        <Typography sx={{ color: 'text.secondary', fontSize: 12 }}>Expires {formatDate(document.expiryDate)}</Typography>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                        <Chip icon={meta.icon} label={meta.label} size="small" sx={{ bgcolor: meta.bg, color: meta.color, fontWeight: 700, '& .MuiChip-icon': { color: 'inherit' } }} />
                        <IconButton size="small" aria-label="edit document" onClick={() => openDocument(document)} sx={{ color: 'text.secondary' }}>
                          <Edit fontSize="small" />
                        </IconButton>
                        <IconButton size="small" aria-label="remove document" onClick={() => handleDeleteDocument(document.id)} sx={{ color: 'text.secondary', '&:hover': { color: '#F6465D' } }}>
                          <DeleteOutline fontSize="small" />
                        </IconButton>
                      </Box>
                    </Box>
                  );
                })
              )}
            </Box>
          )}
        </Box>
      </Paper>

      {/* Edit number plate */}
      <Dialog open={numberDialogOpen} onClose={() => setNumberDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Edit Vehicle</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <TextField
              autoFocus
              required
              label="Number Plate"
              fullWidth
              value={numberDraft}
              onChange={e => setNumberDraft(e.target.value.toUpperCase())}
              error={Boolean(numberError)}
              helperText={numberError || 'Trips are matched to this vehicle by number plate.'}
            />
            <Autocomplete
              freeSolo
              options={VEHICLE_TYPES}
              inputValue={typeDraft}
              onInputChange={(_e, value) => setTypeDraft(value)}
              renderInput={params => (
                <TextField {...params} label="Vehicle Type (Optional)" placeholder="e.g. Truck, Tempo" fullWidth />
              )}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNumberDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveNumber} variant="contained" disabled={saving} sx={{ color: 'primary.contrastText', fontWeight: 700 }}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete vehicle */}
      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete {vehicle.vehicleNumber}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            This removes the vehicle with its maintenance log and document reminders. Its trips are kept.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteVehicle} color="error" variant="contained" disabled={saving} sx={{ fontWeight: 700 }}>
            {saving ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add maintenance */}
      <Dialog open={maintenanceOpen} onClose={() => setMaintenanceOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Maintenance</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Autocomplete
              freeSolo
              options={MAINTENANCE_TYPES}
              inputValue={maintenanceForm.type}
              onInputChange={(_e, value) => setMaintenanceForm(prev => ({ ...prev, type: value }))}
              renderInput={params => (
                <TextField {...params} autoFocus required label="What was done" placeholder="Tyre Change, service, or anything else" />
              )}
            />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
              <TextField
                label="Date"
                type="date"
                fullWidth
                value={maintenanceForm.date}
                onChange={e => setMaintenanceForm(prev => ({ ...prev, date: e.target.value }))}
                InputLabelProps={{ shrink: true }}
              />
              <TextField
                label="Odometer (km)"
                type="number"
                fullWidth
                value={maintenanceForm.odometer}
                onChange={e => setMaintenanceForm(prev => ({ ...prev, odometer: e.target.value }))}
                inputProps={{ min: 0 }}
                helperText={odometer !== undefined ? `Last reading: ${odometer.toLocaleString('en-IN')} km` : undefined}
              />
            </Box>
            <TextField
              label="Cost (₹)"
              type="number"
              fullWidth
              value={maintenanceForm.cost}
              onChange={e => setMaintenanceForm(prev => ({ ...prev, cost: e.target.value }))}
              inputProps={{ min: 0 }}
            />
            <TextField
              label="Notes"
              placeholder="e.g. 2 rear tyres, MRF"
              fullWidth
              multiline
              minRows={2}
              value={maintenanceForm.notes}
              onChange={e => setMaintenanceForm(prev => ({ ...prev, notes: e.target.value }))}
            />
            {maintenanceError && <Typography variant="body2" sx={{ color: '#F6465D' }}>{maintenanceError}</Typography>}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setMaintenanceOpen(false)}>Cancel</Button>
          <Button onClick={handleSaveMaintenance} variant="contained" disabled={saving} sx={{ color: 'primary.contrastText', fontWeight: 700 }}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add/Edit document */}
      <Dialog open={Boolean(docDialog)} onClose={() => setDocDialog(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{docDialog?.document ? 'Edit Document' : 'Add Document'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
            <Autocomplete
              freeSolo
              options={DOCUMENT_LABELS}
              inputValue={docForm.label}
              onInputChange={(_e, value) => setDocForm(prev => ({ ...prev, label: value }))}
              renderInput={params => (
                <TextField {...params} autoFocus label="Document Name" placeholder="Insurance, PUC, or anything else" />
              )}
            />
            <TextField
              label="Expiry Date"
              type="date"
              fullWidth
              value={docForm.expiryDate}
              onChange={e => setDocForm(prev => ({ ...prev, expiryDate: e.target.value }))}
              InputLabelProps={{ shrink: true }}
              helperText={`You'll be reminded ${DEFAULT_REMINDER_DAYS} days before — change that under Document Reminders.`}
            />
            {docError && <Typography variant="body2" sx={{ color: '#F6465D' }}>{docError}</Typography>}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDocDialog(null)}>Cancel</Button>
          <Button onClick={handleSaveDocument} variant="contained" disabled={saving} sx={{ color: 'primary.contrastText', fontWeight: 700 }}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default VehicleDetails;
