import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Plus, Trash2, Edit, ArrowLeft } from "lucide-react";

interface Rule {
  id: string;
  name: string;
  description: string;
  prompt: string;
  color: string;
  created_at: string;
}

const Rules = () => {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    prompt: "",
    color: "#3b82f6",
  });
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    fetchRules();
  }, []);

  const fetchRules = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("evaluation_rules")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setRules(data || []);
    } catch (error: any) {
      toast({
        title: "Error loading rules",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      if (editingRule) {
        const { error } = await supabase
          .from("evaluation_rules")
          .update(formData)
          .eq("id", editingRule.id);

        if (error) throw error;
        toast({ title: "Rule updated successfully" });
      } else {
        const { error } = await supabase
          .from("evaluation_rules")
          .insert([{ ...formData, user_id: user.id }]);

        if (error) throw error;
        toast({ title: "Rule created successfully" });
      }

      setDialogOpen(false);
      setEditingRule(null);
      setFormData({ name: "", description: "", prompt: "", color: "#3b82f6" });
      fetchRules();
    } catch (error: any) {
      toast({
        title: "Error saving rule",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Are you sure you want to delete this rule?")) return;

    try {
      const { error } = await supabase
        .from("evaluation_rules")
        .delete()
        .eq("id", id);

      if (error) throw error;
      toast({ title: "Rule deleted successfully" });
      fetchRules();
    } catch (error: any) {
      toast({
        title: "Error deleting rule",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const openEditDialog = (rule: Rule) => {
    setEditingRule(rule);
    setFormData({
      name: rule.name,
      description: rule.description,
      prompt: rule.prompt,
      color: rule.color,
    });
    setDialogOpen(true);
  };

  const openNewDialog = () => {
    setEditingRule(null);
    setFormData({ name: "", description: "", prompt: "", color: "#3b82f6" });
    setDialogOpen(true);
  };

  if (loading) {
    return <div className="container py-8">Loading...</div>;
  }

  return (
    <div className="container py-8">
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Evaluation Rules</h1>
            <p className="text-muted-foreground">Create and manage rules for sermon evaluation</p>
          </div>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNewDialog}>
              <Plus className="mr-2 h-4 w-4" />
              New Rule
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{editingRule ? "Edit Rule" : "Create New Rule"}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="name">Rule Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g., Scripture References"
                  required
                />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Brief description of what this rule evaluates"
                  required
                />
              </div>
              <div>
                <Label htmlFor="prompt">Evaluation Prompt</Label>
                <Textarea
                  id="prompt"
                  value={formData.prompt}
                  onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
                  placeholder="Detailed instructions for AI evaluation..."
                  className="min-h-[150px]"
                  required
                />
              </div>
              <div>
                <Label htmlFor="color">Color Code</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="color"
                    type="color"
                    value={formData.color}
                    onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                    className="w-20 h-10"
                  />
                  <span className="text-sm text-muted-foreground">{formData.color}</span>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit">
                  {editingRule ? "Update" : "Create"} Rule
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {rules.map((rule) => (
          <Card key={rule.id} className="relative">
            <div
              className="absolute top-0 left-0 w-1 h-full rounded-l"
              style={{ backgroundColor: rule.color }}
            />
            <CardHeader className="pl-6">
              <CardTitle className="flex items-center justify-between">
                {rule.name}
                <div className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openEditDialog(rule)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleDelete(rule.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardTitle>
              <CardDescription>{rule.description}</CardDescription>
            </CardHeader>
            <CardContent className="pl-6">
              <p className="text-sm text-muted-foreground line-clamp-3">{rule.prompt}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {rules.length === 0 && (
        <Card className="py-12">
          <CardContent className="text-center">
            <p className="text-muted-foreground mb-4">No evaluation rules yet</p>
            <Button onClick={openNewDialog}>
              <Plus className="mr-2 h-4 w-4" />
              Create Your First Rule
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default Rules;