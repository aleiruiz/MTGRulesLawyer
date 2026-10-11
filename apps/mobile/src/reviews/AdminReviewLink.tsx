import { useEffect, useState } from "react";
import { Link } from "expo-router";
import { useAuth } from "../auth/AuthProvider";
import { apiUrl } from "../api-url";

export default function AdminReviewLink() {
  const { session } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let active = true;
    setIsAdmin(false);
    if (!session)
      return () => {
        active = false;
      };
    void fetch(`${apiUrl}/api/auth/me`, {
      headers: { authorization: `Bearer ${session.access_token}` },
    })
      .then(async (response) => {
        if (!response.ok) return false;
        const body: unknown = await response.json();
        return typeof body === "object" && body !== null && "role" in body && body.role === "ADMIN";
      })
      .then((allowed) => {
        if (active) setIsAdmin(allowed);
      })
      .catch(() => {
        if (active) setIsAdmin(false);
      });
    return () => {
      active = false;
    };
  }, [session]);

  return isAdmin ? (
    <Link
      href="/review-queue"
      style={{
        alignSelf: "center",
        padding: 10,
        color: "#145da0",
        textDecorationLine: "underline",
      }}
    >
      Challenge review queue
    </Link>
  ) : null;
}
