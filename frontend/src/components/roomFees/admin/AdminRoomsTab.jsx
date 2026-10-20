import { Archive, BedDouble, Edit2, Plus, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../../ui/badge.jsx';
import { Button } from '../../ui/button.jsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../ui/dialog.jsx';
import { Input } from '../../ui/input.jsx';
import { Label } from '../../ui/label.jsx';
import { Select } from '../../ui/select.jsx';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table.jsx';
import { ROOMMATES } from '../../../lib/constants.js';
import { api } from '../../../lib/api.js';
import { getIndiaCurrentLogicalMonth } from '../../../lib/logicalDate.js';

export function AdminRoomsTab({ rooms = [], onRefresh, role, loading = false, error = '' }) {
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState(null);

  // Add room state
  const [newRoomNumber, setNewRoomNumber] = useState('');
  const [newRoomLabel, setNewRoomLabel] = useState('');
  const [newRoomCapacity, setNewRoomCapacity] = useState('2');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Edit room state
  const [editRoomLabel, setEditRoomLabel] = useState('');
  const [editRoomCapacity, setEditRoomCapacity] = useState('2');
  const [editRoomActive, setEditRoomActive] = useState(true);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState('');

  // Assign member state
  const [assignMemberId, setAssignMemberId] = useState('nikhil');
  const [assignRoomId, setAssignRoomId] = useState('');
  const [assignFromMonth, setAssignFromMonth] = useState(() => getIndiaCurrentLogicalMonth());
  const [assignUntilMonth, setAssignUntilMonth] = useState('');

  const handleCreateRoom = async (e) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      await api.post('/api/rooms', {
        roomNumber: newRoomNumber.trim(),
        roomLabel: newRoomLabel.trim() || undefined,
        capacity: Number(newRoomCapacity),
      });
      setAddDialogOpen(false);
      setNewRoomNumber('');
      setNewRoomLabel('');
      onRefresh();
    } catch (err) {
      setFormError(err.message || 'Failed to create room.');
    } finally {
      setSubmitting(false);
    }
  };

  const openEditRoom = (room) => {
    setEditingRoom(room);
    setEditRoomLabel(room.roomLabel || '');
    setEditRoomCapacity(String(room.capacity || 2));
    setEditRoomActive(Boolean(room.active));
    setEditError('');
    setEditDialogOpen(true);
  };

  const handleUpdateRoom = async (e) => {
    e.preventDefault();
    if (!editingRoom) return;
    setEditError('');

    const occupantsCount = editingRoom.currentOccupancyCount ?? (editingRoom.currentOccupants || []).length;
    const newCap = Number(editRoomCapacity);
    if (newCap < occupantsCount) {
      setEditError(`Cannot reduce capacity to ${newCap}. Room currently has ${occupantsCount} active occupant(s).`);
      return;
    }

    setEditSubmitting(true);
    try {
      await api.patch(`/api/rooms/${editingRoom.roomId}`, {
        roomLabel: editRoomLabel.trim() || '',
        capacity: newCap,
        active: editRoomActive,
      });
      setEditDialogOpen(false);
      onRefresh();
    } catch (err) {
      setEditError(err.message || 'Failed to update room.');
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleAssignMember = async (e) => {
    e.preventDefault();
    setFormError('');
    setSubmitting(true);
    try {
      await api.post('/api/room-fees/assignments', {
        memberId: assignMemberId,
        roomId: assignRoomId,
        effectiveFromMonth: assignFromMonth,
        effectiveUntilMonth: assignUntilMonth || undefined,
      });
      setAssignDialogOpen(false);
      onRefresh();
    } catch (err) {
      setFormError(err.message || 'Failed to assign room.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchiveToggle = async (room) => {
    try {
      await api.patch(`/api/rooms/${room.roomId}`, {
        active: !room.active,
      });
      onRefresh();
    } catch (err) {
      alert(err.message || 'Failed to update room.');
    }
  };

  if (loading) {
    return (
      <Card className="border-slate-200 dark:border-slate-800 p-8 text-center">
        <p className="text-xs text-slate-500 dark:text-slate-400">Loading hostel rooms...</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20 p-6 text-center">
        <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">{error}</p>
        {onRefresh && (
          <Button onClick={onRefresh} size="sm" variant="outline" className="mt-3 text-xs">
            Retry
          </Button>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top action bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Room Registry & Occupancy
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Define hostel rooms, occupancy limits, and manage member stay assignments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setAssignRoomId(rooms[0]?.roomId || '');
              setAssignDialogOpen(true);
            }}
            className="gap-1.5 text-xs font-semibold"
            disabled={rooms.length === 0}
          >
            <UserPlus className="h-4 w-4" />
            <span>Assign Member</span>
          </Button>
          <Button
            size="sm"
            onClick={() => setAddDialogOpen(true)}
            className="gap-1.5 text-xs font-semibold"
          >
            <Plus className="h-4 w-4" />
            <span>Add Room</span>
          </Button>
        </div>
      </div>

      {/* Rooms Table */}
      <Card className="border-slate-200/90 dark:border-slate-800 shadow-xs">
        <CardContent className="p-0">
          {rooms.length === 0 ? (
            <div className="p-8 text-center">
              <BedDouble className="h-8 w-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                No rooms created yet
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Add your hostel rooms to start assigning residents and tracking fees.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Room</TableHead>
                  <TableHead>Label</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead>Current Occupants</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rooms.map((room) => {
                  const occupants = room.currentOccupants || [];
                  const isFull = occupants.length >= room.capacity;

                  return (
                    <TableRow key={room.roomId}>
                      <TableCell className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                        <BedDouble className="h-4 w-4 text-teal-600" />
                        <span>Room {room.roomNumber}</span>
                      </TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-400">
                        {room.roomLabel || '—'}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium">
                          {room.capacity === 1 ? '1 (Single)' : room.capacity === 2 ? '2 (Double)' : room.capacity}
                        </span>
                      </TableCell>
                      <TableCell>
                        {occupants.length === 0 ? (
                          <span className="text-slate-400 italic text-xs">Vacant</span>
                        ) : (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {occupants.map((occ) => {
                              const r = ROOMMATES.find((m) => m.id === occ.memberId);
                              return (
                                <Badge key={occ.memberId} variant="secondary" className="text-xs py-0 px-2 font-medium">
                                  {r?.name || occ.name || occ.memberId}
                                </Badge>
                              );
                            })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={room.active ? 'taking' : 'outline'} className="text-[10px] py-0">
                          {room.active ? 'Active' : 'Archived'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="compact"
                            onClick={() => openEditRoom(room)}
                            className="text-xs text-teal-700 hover:text-teal-800"
                          >
                            <Edit2 className="h-3.5 w-3.5 mr-1" />
                            <span>Edit</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="compact"
                            onClick={() => handleArchiveToggle(room)}
                            className="text-xs text-slate-500 hover:text-slate-900"
                          >
                            {room.active ? 'Archive' : 'Restore'}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Add Room Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-md w-full p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
              Add New Hostel Room
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Register a room number and set occupancy limit.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateRoom} className="space-y-4 pt-2">
            {formError && (
              <div className="p-2.5 rounded bg-red-50 text-red-700 text-xs border border-red-200">
                {formError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="roomNumber">Room Number / Name *</Label>
              <Input
                id="roomNumber"
                placeholder="e.g. 204 or A-101"
                value={newRoomNumber}
                onChange={(e) => setNewRoomNumber(e.target.value)}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="roomLabel">Display Label (optional)</Label>
              <Input
                id="roomLabel"
                placeholder="e.g. Second Floor Corner Room"
                value={newRoomLabel}
                onChange={(e) => setNewRoomLabel(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="capacity">Occupancy Capacity *</Label>
              <Select
                id="capacity"
                value={newRoomCapacity}
                onChange={(e) => setNewRoomCapacity(e.target.value)}
              >
                <option value="1">1 person (Single)</option>
                <option value="2">2 persons (Double)</option>
                <option value="3">3 persons (Triple)</option>
                <option value="4">4 persons (Quad)</option>
              </Select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAddDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting ? 'Creating...' : 'Create Room'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Room Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md w-full p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
              Edit Room {editingRoom?.roomNumber}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Update room label, capacity, and active status.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleUpdateRoom} className="space-y-4 pt-2">
            {editError && (
              <div className="p-2.5 rounded bg-red-50 text-red-700 text-xs border border-red-200">
                {editError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="editRoomLabel">Display Label</Label>
              <Input
                id="editRoomLabel"
                placeholder="e.g. Second Floor Balcony Room"
                value={editRoomLabel}
                onChange={(e) => setEditRoomLabel(e.target.value)}
              />
              <span className="text-[11px] text-slate-400 block">
                Optional. Leave empty to reset to "Room {editingRoom?.roomNumber}".
              </span>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="editRoomCapacity">Occupancy Capacity *</Label>
              <Select
                id="editRoomCapacity"
                value={editRoomCapacity}
                onChange={(e) => setEditRoomCapacity(e.target.value)}
              >
                <option value="1">1 person (Single)</option>
                <option value="2">2 persons (Double)</option>
                <option value="3">3 persons (Triple)</option>
                <option value="4">4 persons (Quad)</option>
              </Select>
              {editingRoom && (
                <span className="text-[11px] text-slate-400 block">
                  Current active occupants: {editingRoom.currentOccupancyCount ?? (editingRoom.currentOccupants || []).length}. Capacity cannot be set lower.
                </span>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="editRoomStatus">Room Status</Label>
              <Select
                id="editRoomStatus"
                value={editRoomActive ? 'active' : 'archived'}
                onChange={(e) => setEditRoomActive(e.target.value === 'active')}
              >
                <option value="active">Active (available for stays)</option>
                <option value="archived">Archived (inactive)</option>
              </Select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={editSubmitting}>
                {editSubmitting ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Assign Member Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
        <DialogContent className="max-w-md w-full p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
              Assign Member to Room
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Assign a member with an effective start month.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleAssignMember} className="space-y-4 pt-2">
            {formError && (
              <div className="p-2.5 rounded bg-red-50 text-red-700 text-xs border border-red-200">
                {formError}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="assignMember">Member *</Label>
              <Select
                id="assignMember"
                value={assignMemberId}
                onChange={(e) => setAssignMemberId(e.target.value)}
              >
                {ROOMMATES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="assignRoom">Target Room *</Label>
              <Select
                id="assignRoom"
                value={assignRoomId}
                onChange={(e) => setAssignRoomId(e.target.value)}
                required
              >
                {rooms.map((r) => (
                  <option key={r.roomId} value={r.roomId}>
                    Room {r.roomNumber} ({r.roomLabel || `Cap: ${r.capacity}`})
                  </option>
                ))}
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fromMonth">Effective From *</Label>
                <Input
                  id="fromMonth"
                  type="month"
                  value={assignFromMonth}
                  onChange={(e) => setAssignFromMonth(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="untilMonth">Until (optional)</Label>
                <Input
                  id="untilMonth"
                  type="month"
                  value={assignUntilMonth}
                  onChange={(e) => setAssignUntilMonth(e.target.value)}
                  placeholder="Ongoing"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setAssignDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                {submitting ? 'Saving...' : 'Save Assignment'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
