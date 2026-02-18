import { useState, useEffect } from "react";
import { useUser, useAuth, SignIn } from "@clerk/clerk-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Trash2, Edit, Plus, Copy, Check } from "lucide-react";

interface User {
  id: string;
  clerkId?: string;
  name: string;
  email?: string;
  role: string;
  createdAt: string;
}

export default function Admin() {
  const { isSignedIn, user, isLoaded } = useUser();
  const { getToken } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Check if user has admin role via Clerk publicMetadata
  const isAdmin = (user?.publicMetadata as { role?: string })?.role === 'admin';

  useEffect(() => {
    if (isSignedIn && isAdmin) {
      loadUsers();
    }
  }, [isSignedIn, isAdmin]);

  async function getAuthHeaders() {
    const token = await getToken();
    return {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  async function loadUsers() {
    try {
      const headers = await getAuthHeaders();
      const resp = await fetch("/api/admin/users", { headers });

      if (!resp.ok) throw new Error("Failed to load users");

      const data = await resp.json();
      setUsers(data.users || []);
    } catch (e) {
      toast.error("Failed to load users");
    }
  }

  async function handleAddUser() {
    if (!newUserName.trim()) {
      toast.error("Name is required");
      return;
    }

    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const resp = await fetch("/api/admin/users", {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: newUserName,
          email: newUserEmail || null,
        }),
      });

      if (!resp.ok) throw new Error("Failed to add user");

      const data = await resp.json();
      toast.success(`User added: ${data.user.name}`);
      setShowAddDialog(false);
      setNewUserName("");
      setNewUserEmail("");
      loadUsers();
    } catch (e) {
      toast.error("Failed to add user");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateUser(id: string, name: string, email: string | undefined) {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const resp = await fetch("/api/admin/users", {
        method: "PUT",
        headers,
        body: JSON.stringify({ id, name, email }),
      });

      if (!resp.ok) throw new Error("Failed to update user");

      toast.success("User updated");
      setEditingUser(null);
      loadUsers();
    } catch (e) {
      toast.error("Failed to update user");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteUser(id: string) {
    if (!confirm("Delete this user?")) return;

    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const resp = await fetch("/api/admin/users", {
        method: "DELETE",
        headers,
        body: JSON.stringify({ id }),
      });

      if (!resp.ok) throw new Error("Failed to delete user");

      toast.success("User deleted");
      loadUsers();
    } catch (e) {
      toast.error("Failed to delete user");
    } finally {
      setLoading(false);
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text);
    setCopiedId(text);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success("Copied!");
  }

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <SignIn routing="hash" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access Denied</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">You do not have admin access. Please contact an administrator.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-10">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Admin Panel</h1>
            <p className="text-muted-foreground">Manage bot users</p>
          </div>
          <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2" size={16} /> Add User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New User</DialogTitle>
                <DialogDescription>Create a new user record in the database.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input
                    id="name"
                    value={newUserName}
                    onChange={(e) => setNewUserName(e.target.value)}
                    placeholder="User name"
                  />
                </div>
                <div>
                  <Label htmlFor="email">Email (optional)</Label>
                  <Input
                    id="email"
                    type="email"
                    value={newUserEmail}
                    onChange={(e) => setNewUserEmail(e.target.value)}
                    placeholder="user@example.com"
                  />
                </div>
                <Button onClick={handleAddUser} disabled={loading} className="w-full">
                  Add User
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </header>

        <div className="grid gap-4">
          {users.length === 0 && (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No users yet. Add your first user!
              </CardContent>
            </Card>
          )}

          {users.map((user) => (
            <Card key={user.id}>
              <CardContent className="py-4">
                {editingUser?.id === user.id ? (
                  <div className="space-y-4">
                    <div>
                      <Label>Name</Label>
                      <Input
                        value={editingUser.name}
                        onChange={(e) =>
                          setEditingUser({ ...editingUser, name: e.target.value })
                        }
                      />
                    </div>
                    <div>
                      <Label>Email</Label>
                      <Input
                        type="email"
                        value={editingUser.email || ""}
                        onChange={(e) =>
                          setEditingUser({ ...editingUser, email: e.target.value || undefined })
                        }
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() =>
                          handleUpdateUser(
                            editingUser.id,
                            editingUser.name,
                            editingUser.email
                          )
                        }
                        disabled={loading}
                      >
                        Save
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setEditingUser(null)}
                        disabled={loading}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <div className="font-semibold text-lg">{user.name}</div>
                      {user.email && (
                        <div className="text-sm text-muted-foreground">{user.email}</div>
                      )}
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">ID:</span>
                        <code className="bg-muted px-2 py-1 rounded text-xs font-mono">
                          {user.id.slice(0, 12)}...
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(user.id)}
                        >
                          {copiedId === user.id ? (
                            <Check size={16} className="text-green-500" />
                          ) : (
                            <Copy size={16} />
                          )}
                        </Button>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Role: {user.role} | Created: {new Date(user.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingUser(user)}
                      >
                        <Edit size={16} />
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDeleteUser(user.id)}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
