import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { confirm } = await req.json();

    if (!confirm) {
      return json({ error: "Delete confirmation is required." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
    const authHeader = req.headers.get("Authorization");

    if (!supabaseUrl || !serviceRoleKey || !authHeader) {
      return json({ error: "Server delete function is not configured." }, 500);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const jwt = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await serviceClient.auth.getUser(jwt);

    if (userError || !user) {
      return json({ error: "Invalid session." }, 401);
    }

    const userId = user.id;

    const { data: ownedRooms, error: ownedRoomsError } = await serviceClient
      .from("rooms")
      .select("id")
      .eq("created_by", userId);

    if (ownedRoomsError) throw ownedRoomsError;

    const ownedRoomIds = (ownedRooms || []).map((room) => room.id);

    if (ownedRoomIds.length) {
      await assertOk(serviceClient.from("private_notes").delete().in("room_id", ownedRoomIds));
      await assertOk(serviceClient.from("messages").delete().in("room_id", ownedRoomIds));
      await assertOk(serviceClient.from("room_members").delete().in("room_id", ownedRoomIds));
      await assertOk(serviceClient.from("rooms").delete().in("id", ownedRoomIds));
    }

    await assertOk(serviceClient.from("private_notes").delete().eq("user_id", userId));
    await assertOk(serviceClient.from("messages").delete().eq("sender_id", userId));
    await assertOk(serviceClient.from("messages").delete().eq("receiver_id", userId));
    await assertOk(serviceClient.from("room_members").delete().eq("user_id", userId));
    await assertOk(serviceClient.from("profiles").delete().eq("id", userId));

    const { error: deleteUserError } = await serviceClient.auth.admin.deleteUser(userId);

    if (deleteUserError) throw deleteUserError;

    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Account delete failed.";
    console.error("delete-user-account failed:", error);
    return json({ error: message }, 500);
  }
});

async function assertOk(query: PromiseLike<{ error: unknown | null }>) {
  const { error } = await query;

  if (error) throw error;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
