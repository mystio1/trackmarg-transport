import { useState } from 'react';
import {
  Avatar,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  GridLegacy as Grid,
  InputAdornment,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Paper,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { CheckCircle, HourglassTop, Cancel, LocalShipping, Add, Edit, Send } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import LoadingOverlay from '../components/LoadingOverlay';
import type { Trip, TripStatus } from '../types';
import EmptyState from '../components/EmptyState';

function statusMeta(status: TripStatus | undefined) {
  if (status === 'approved') {
    return { label: 'Approved', color: '#0ECB81', icon: <CheckCircle /> };
  }
  if (status === 'rejected') {
    return { label: 'Rejected', color: '#F6465D', icon: <Cancel /> };
  }
  return { label: 'Pending', color: '#F0B90B', icon: <HourglassTop /> };
}

type EditForm = {
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  date: string;
  pickupLocation: string;
  dropLocation: string;
  vehicleType: string;
  vehicleNumber: string;
  materialType: string;
  amount: string;
};

const DriverTrips = () => {
  const { allTrips, user, group, tripEditRequests, updateTrip, requestTripEdit } = useAppContext();
  const theme = useTheme();
  const navigate = useNavigate();
  const myTrips = allTrips.filter((trip: Trip) => trip.driverId === user?.id);

  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  const [requestingTrip, setRequestingTrip] = useState<Trip | null>(null);
  const [requestMessage, setRequestMessage] = useState('');
  const [sendingRequest, setSendingRequest] = useState(false);
  const [requestError, setRequestError] = useState('');

  const openEdit = (trip: Trip) => {
    setEditForm({
      customerName: trip.customerName || '',
      customerPhone: trip.customerPhone || '',
      customerAddress: trip.customerAddress || '',
      date: trip.date ? trip.date.slice(0, 10) : new Date().toISOString().slice(0, 10),
      pickupLocation: trip.pickupLocation || '',
      dropLocation: trip.dropLocation || '',
      vehicleType: trip.vehicleType || '',
      vehicleNumber: trip.vehicleNumber || '',
      materialType: trip.materialType || '',
      amount: String(trip.amount || ''),
    });
    setEditError('');
    setEditingTrip(trip);
  };

  const updateEditField = (key: keyof EditForm, value: string) =>
    setEditForm(prev => (prev ? { ...prev, [key]: value } : prev));

  const handleSaveEdit = async () => {
    if (!editingTrip || !editForm) return;
    setSavingEdit(true);
    setEditError('');
    try {
      await updateTrip(editingTrip.id, {
        ...editForm,
        date: new Date(editForm.date).toISOString(),
        amount: Number(editForm.amount) || 0,
      });
      setEditingTrip(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : 'Could not save changes');
    } finally {
      setSavingEdit(false);
    }
  };

  const openRequestUpdate = (trip: Trip) => {
    setRequestMessage('');
    setRequestError('');
    setRequestingTrip(trip);
  };

  const handleSendRequest = async () => {
    if (!requestingTrip) return;
    const message = requestMessage.trim();
    if (!message) {
      setRequestError('Describe what needs to change.');
      return;
    }
    setSendingRequest(true);
    setRequestError('');
    try {
      await requestTripEdit(requestingTrip.id, message);
      setRequestingTrip(null);
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Could not send the request');
    } finally {
      setSendingRequest(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <Paper elevation={0} sx={{ p: 3, bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
        <Typography variant="h5" sx={{ color: '#F0B90B', fontWeight: 800 }}>
          My Trips
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Group code: <strong>{group?.code}</strong>. Status updates appear automatically.
        </Typography>
      </Paper>

      <Paper elevation={0} sx={{ p: { xs: 2, sm: 3 }, bgcolor: 'background.paper', border: `1px solid ${theme.palette.divider}` }}>
        {myTrips.length === 0 ? (
          <EmptyState
            icon={<LocalShipping />}
            title="No trips submitted yet"
            description="Submit your first trip and it'll show up here with its approval status."
            action={{ label: 'Submit a Trip', onClick: () => navigate('/submit'), icon: <Add /> }}
          />
        ) : (
          <List sx={{ p: 0 }}>
            {myTrips.map(trip => {
              const meta = statusMeta(trip.status);
              const pendingRequest = tripEditRequests.find(r => r.tripId === trip.id && r.status === 'pending');
              return (
                <ListItem
                  key={trip.id}
                  sx={{
                    mb: 1.5,
                    bgcolor: 'action.hover',
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: 2,
                    alignItems: 'flex-start',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', width: '100%' }}>
                    <ListItemAvatar>
                      <Avatar sx={{ bgcolor: `${meta.color}22`, color: meta.color }}>
                        {meta.icon}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      sx={{ pr: { xs: 0, sm: 10 } }}
                      primary={
                        <Typography sx={{ color: 'text.primary', fontWeight: 800 }}>
                          {trip.customerName || 'Customer'} - ₹{Number(trip.amount || 0).toFixed(2)}
                        </Typography>
                      }
                      secondary={
                        <Box sx={{ color: 'text.secondary', mt: 0.5 }}>
                          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            {new Date(trip.date).toLocaleDateString('en-IN')} | {trip.pickupLocation} to {trip.dropLocation}
                          </Typography>
                          {trip.rejectionReason && (
                            <Typography variant="body2" sx={{ color: '#F6465D', mt: 0.5 }}>
                              Reason: {trip.rejectionReason}
                            </Typography>
                          )}
                          {pendingRequest && (
                            <Typography variant="body2" sx={{ color: '#F0B90B', mt: 0.5, fontWeight: 600 }}>
                              Update requested: "{pendingRequest.message}" — waiting for admin.
                            </Typography>
                          )}
                        </Box>
                      }
                    />
                    <Chip
                      label={meta.label}
                      sx={{ bgcolor: `${meta.color}22`, color: meta.color, fontWeight: 800, flexShrink: 0 }}
                    />
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1, pl: { xs: 0, sm: 7 } }}>
                    {trip.status === 'pending' && (
                      <Button size="small" variant="outlined" startIcon={<Edit />} onClick={() => openEdit(trip)}>
                        Edit
                      </Button>
                    )}
                    {trip.status === 'approved' && !pendingRequest && (
                      <Button size="small" variant="outlined" startIcon={<Send />} onClick={() => openRequestUpdate(trip)}>
                        Request Update
                      </Button>
                    )}
                  </Box>
                </ListItem>
              );
            })}
          </List>
        )}
      </Paper>

      {/* Edit a still-pending trip directly */}
      <Dialog
        open={Boolean(editingTrip)}
        onClose={() => setEditingTrip(null)}
        maxWidth="sm"
        fullWidth
        PaperProps={{ sx: { position: 'relative', overflow: 'hidden' } }}
      >
        <LoadingOverlay open={savingEdit} absolute label="Saving trip…" />
        <DialogTitle>Edit Trip</DialogTitle>
        <DialogContent>
          {editError && <Typography variant="body2" sx={{ color: '#F6465D', mb: 2 }}>{editError}</Typography>}
          {editForm && (
            <Grid container spacing={2} sx={{ mt: 0.5 }}>
              <Grid item xs={12} sm={6}>
                <TextField label="Customer Name" value={editForm.customerName} onChange={e => updateEditField('customerName', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Customer Phone" value={editForm.customerPhone} onChange={e => updateEditField('customerPhone', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12}>
                <TextField label="Customer Address" value={editForm.customerAddress} onChange={e => updateEditField('customerAddress', e.target.value)} fullWidth multiline rows={2} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Trip Date" type="date" value={editForm.date} onChange={e => updateEditField('date', e.target.value)} fullWidth InputLabelProps={{ shrink: true }} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Vehicle Type (Optional)" value={editForm.vehicleType} onChange={e => updateEditField('vehicleType', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Vehicle Number" value={editForm.vehicleNumber} onChange={e => updateEditField('vehicleNumber', e.target.value.toUpperCase())} fullWidth />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Pickup Location" value={editForm.pickupLocation} onChange={e => updateEditField('pickupLocation', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Drop Location" value={editForm.dropLocation} onChange={e => updateEditField('dropLocation', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField label="Material Type" value={editForm.materialType} onChange={e => updateEditField('materialType', e.target.value)} fullWidth />
              </Grid>
              <Grid item xs={12} sm={6}>
                <TextField
                  label="Amount"
                  type="number"
                  value={editForm.amount}
                  onChange={e => updateEditField('amount', e.target.value)}
                  fullWidth
                  InputProps={{ startAdornment: <InputAdornment position="start">₹</InputAdornment> }}
                />
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingTrip(null)} disabled={savingEdit}>Cancel</Button>
          <Button onClick={handleSaveEdit} variant="contained" disabled={savingEdit} sx={{ color: 'primary.contrastText', fontWeight: 700 }}>
            {savingEdit ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Request a change to an already-approved trip */}
      <Dialog
        open={Boolean(requestingTrip)}
        onClose={() => setRequestingTrip(null)}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { position: 'relative', overflow: 'hidden' } }}
      >
        <LoadingOverlay open={sendingRequest} absolute label="Sending request…" />
        <DialogTitle>Request an Update</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
            This trip is already approved, so changes need admin sign-off. Describe what needs to
            change and the admin will update it.
          </Typography>
          {requestError && <Typography variant="body2" sx={{ color: '#F6465D', mb: 2 }}>{requestError}</Typography>}
          <TextField
            autoFocus
            label="What needs to change?"
            placeholder="e.g. Amount should be ₹5000, not ₹4500"
            value={requestMessage}
            onChange={e => setRequestMessage(e.target.value)}
            fullWidth
            multiline
            rows={3}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRequestingTrip(null)} disabled={sendingRequest}>Cancel</Button>
          <Button onClick={handleSendRequest} variant="contained" disabled={sendingRequest} sx={{ color: 'primary.contrastText', fontWeight: 700 }}>
            {sendingRequest ? 'Sending...' : 'Send Request'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DriverTrips;
