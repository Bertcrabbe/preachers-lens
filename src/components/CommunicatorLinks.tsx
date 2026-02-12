import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { ExternalLink, Plus, Trash2, Link as LinkIcon } from "lucide-react";

interface CommunicatorLink {
  id: string;
  label: string;
  url: string;
  communicator_id: string;
  user_id: string;
  created_at: string;
}

interface CommunicatorLinksProps {
  communicatorId: string;
  compact?: boolean;
}

export const CommunicatorLinks = ({ communicatorId, compact = false }: CommunicatorLinksProps) => {
  const { toast } = useToast();
  const [links, setLinks] = useState<CommunicatorLink[]>([]);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newUrl, setNewUrl] = useState("");

  useEffect(() => {
    fetchLinks();
  }, [communicatorId]);

  const fetchLinks = async () => {
    const { data, error } = await supabase
      .from("communicator_links")
      .select("*")
      .eq("communicator_id", communicatorId)
      .order("created_at", { ascending: true });

    if (!error && data) setLinks(data as CommunicatorLink[]);
  };

  const handleAdd = async () => {
    if (!newLabel.trim() || !newUrl.trim()) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    let url = newUrl.trim();
    if (!/^https?:\/\//i.test(url)) url = "https://" + url;

    const { data, error } = await supabase
      .from("communicator_links")
      .insert({ communicator_id: communicatorId, user_id: user.id, label: newLabel.trim(), url })
      .select()
      .single();

    if (error) {
      toast({ title: "Error", description: "Failed to add link", variant: "destructive" });
      return;
    }

    setLinks([...links, data as CommunicatorLink]);
    setNewLabel("");
    setNewUrl("");
    setAdding(false);
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("communicator_links").delete().eq("id", id);
    if (!error) setLinks(links.filter(l => l.id !== id));
  };

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5 mt-1" onClick={(e) => e.stopPropagation()}>
        {links.map((link) => (
          <a
            key={link.id}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            <LinkIcon className="h-2.5 w-2.5" />
            {link.label}
          </a>
        ))}
        {links.length === 0 && (
          <span className="text-xs text-muted-foreground">No links</span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
      {links.map((link) => (
        <div key={link.id} className="flex items-center gap-2 group">
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-sm text-primary hover:underline flex-1 min-w-0"
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{link.label}</span>
          </a>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            onClick={() => handleDelete(link.id)}
          >
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        </div>
      ))}

      {adding ? (
        <div className="space-y-2">
          <Input
            placeholder="Label (e.g. YouTube)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
          <Input
            placeholder="URL"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            className="h-8 text-sm"
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
          <div className="flex gap-1">
            <Button size="sm" className="h-7 text-xs" onClick={handleAdd} disabled={!newLabel.trim() || !newUrl.trim()}>
              Add
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setAdding(false); setNewLabel(""); setNewUrl(""); }}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1" onClick={() => setAdding(true)}>
          <Plus className="h-3 w-3" />
          Add Link
        </Button>
      )}
    </div>
  );
};
