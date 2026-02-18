import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Trash2, Edit, Plus, Copy, Check } from "lucide-react";

interface User {
  id: string;
  name: string;
  code: string;
  expiryDate: string | null;
  createdAt: string;
}

export default function Admin() {
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserExpiry, setNewUserExpiry] = useState("");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem("admin_token");
    if (token) {
      setAuthenticated(true);
      loadUsers();
    }
  }, []);

  async function handleLogin() {
    setLoading(true);
    try {
      const resp = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await resp.json();

      if (data.success && data.token) {
        sessionStorage.setItem("admin_token", data.token);
        setAuthenticated(true);
        loadUsers();
      } else {
        toast.error("Incorrect password");
      }
    } catch {
      toast.error("Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function loadUsers() {
    try {
      const token = sessionStorage.getItem("admin_token");
      const resp = await fetch("/api/admin/users", {
        headers: { "Authorization": `Bearer ${token}` },
      });

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
      const token = sessionStorage.getItem("admin_token");
      const resp = await fetch("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: newUserName,
          expiryDate: newUserExpiry || null,
        }),
      });

      if (!resp.ok) throw new Error("Failed to add user");

      const data = await resp.json();
      toast.success(`User added! Code: ${data.user.code}`);
      setShowAddDialog(false);
      setNewUserName("");
      setNewUserExpiry("");
      loadUsers();
    } catch (e) {
      toast.error("Failed to add user");
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdateUser(id: string, name: string, expiryDate: string | null) {
    setLoading(true);
    try {
      const token = sessionStorage.getItem("admin_token");
      const resp = await fetch("/api/admin/users", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
        body: JSON.stringify({ id, name, expiryDate }),
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
      const token = sessionStorage.getItem("admin_token");
      const resp = await fetch("/api/admin/users", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
        },
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

  function copyToClipboard(code: string) {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
    toast.success("Code copied!");
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Admin Login</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                placeholder="Enter admin password"
              />
            </div>
            <Button onClick={handleLogin} disabled={loading} className="w-full">
              Login
            </Button>
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
                <DialogDescription>Create a new user with access code for the coaching bot.</DialogDescription>
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
                  <Label htmlFor="expiry">Expiry Date (optional)</Label>
                  <Input
                    id="expiry"
                    type="datetime-local"
                    value={newUserExpiry}
                    onChange={(e) => setNewUserExpiry(e.target.value)}
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
                      <Label>Expiry Date</Label>
                      <Input
                        type="datetime-local"
                        value={editingUser.expiryDate || ""}
                        onChange={(e) =>
                          setEditingUser({ ...editingUser, expiryDate: e.target.value || null })
                        }
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() =>
                          handleUpdateUser(
                            editingUser.id,
                            editingUser.name,
                            editingUser.expiryDate
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
                      <div className="flex items-center gap-2">
                        <code className="bg-muted px-2 py-1 rounded text-sm font-mono">
                          {user.code}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(user.code)}
                        >
                          {copiedCode === user.code ? (
                            <Check size={16} className="text-green-500" />
                          ) : (
                            <Copy size={16} />
                          )}
                        </Button>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Created: {new Date(user.createdAt).toLocaleString()}
                      </div>
                      {user.expiryDate && (
                        <div className="text-sm text-muted-foreground">
                          Expires: {new Date(user.expiryDate).toLocaleString()}
                        </div>
                      )}
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
