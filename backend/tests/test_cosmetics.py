import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.routers.cosmetics import _raise_api_error
from app.services.supabase import SupabaseAPIError, get_avatar_state, unequip_cosmetic


class TestAvatarCosmetics(unittest.TestCase):
    @patch("app.services.supabase._request")
    def test_pet_cosmetic_is_returned_as_owned_and_equipped(self, request):
        request.side_effect = [
            [{"id": "user-1", "total_xp": 0, "acorn_balance": 100, "tier": "Baby"}],
            [
                {
                    "id": "pet-bunny",
                    "name": "Bunny",
                    "description": "A floating friend.",
                    "category": "pet",
                    "cost_acorns": 35,
                    "minimum_tier": "Baby",
                    "asset_key": "bunny",
                    "is_tier_gift": False,
                }
            ],
            [{"cosmetic_id": "pet-bunny", "is_equipped": True, "slot": "pet"}],
        ]

        state = get_avatar_state("user-1")

        self.assertEqual(state["equipped"]["pet"], "pet-bunny")
        self.assertEqual(
            state["cosmetics"],
            [
                {
                    "id": "pet-bunny",
                    "name": "Bunny",
                    "description": "A floating friend.",
                    "category": "pet",
                    "cost_acorns": 35,
                    "minimum_tier": "Baby",
                    "asset_key": "bunny",
                    "is_tier_gift": False,
                    "owned": True,
                    "equipped": True,
                }
            ],
        )


class TestCosmeticUnequip(unittest.TestCase):
    @patch("app.services.supabase._request", return_value={"unequipped": True, "slot": "head"})
    def test_unequip_calls_trusted_slot_rpc(self, request):
        result = unequip_cosmetic("user-1", "head")

        self.assertEqual(result, {"unequipped": True, "slot": "head"})
        request.assert_called_once_with(
            "POST",
            "rpc/unequip_cosmetic",
            payload={"p_user_id": "user-1", "p_slot": "head"},
        )

    def test_missing_unequip_function_returns_migration_guidance(self):
        with self.assertRaises(HTTPException) as raised:
            _raise_api_error(
                SupabaseAPIError(404, "PGRST202", "RPC missing from schema cache")
            )

        self.assertEqual(raised.exception.status_code, 503)
        self.assertIn("20261018_cosmetic_unequip.sql", raised.exception.detail)


if __name__ == "__main__":
    unittest.main()
