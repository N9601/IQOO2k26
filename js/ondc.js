/*
 * Draft mapping from a Truthbox manifest to an ONDC IGM (Issue and
 * Grievance Management) style payload, so a marketplace dispute can be
 * raised with the cryptographic evidence attached. The mapping is a
 * draft against the public IGM shape; field names are finalized with
 * the network participant during integration.
 */

export function manifestToOndcIssue(m, verifyLink) {
  const now = new Date().toISOString();
  const flagged = m.verdict?.overall !== "VERIFIED";
  return {
    context: {
      domain: "ONDC:RET10",
      action: "issue",
      core_version: "1.2.0",
      timestamp: now,
      ttl: "PT30S",
    },
    message: {
      issue: {
        id: "TBX-" + (m.order?.id || "UNKNOWN") + "-" + now.slice(0, 10),
        category: "ITEM",
        sub_category: flagged ? "ITM02" : "ITM04", // quality vs quantity per IGM taxonomy
        created_at: now,
        issue_type: "ISSUE",
        status: "OPEN",
        order_details: {
          id: m.order?.id,
          state: "Completed",
          items: [{ descriptor: m.order?.expectedClass, serial: m.verdict?.serial ?? null }],
        },
        description: {
          short_desc: flagged
            ? "Return claim contested: Truthbox verified-unboxing evidence contradicts the claim"
            : "Return claim supported by Truthbox verified-unboxing evidence",
          long_desc:
            `Cryptographically signed unboxing capture for order ${m.order?.id}. ` +
            `${m.chain?.links?.length ?? 0} frames hash-chained, Merkle root ${m.chain?.merkleRoot}, ` +
            `ECDSA P-256 signature over the full manifest. Capture verdict: ${m.verdict?.overall}. ` +
            `Independent verification requires no Truthbox service.`,
          additional_desc: {
            url: verifyLink || null,
            content_type: "text/html",
          },
        },
        source: { network_participant_id: "truthbox-demo", type: "SELLER" },
        expected_response_time: { duration: "PT2H" },
        expected_resolution_time: { duration: "P1D" },
        evidence: {
          truthbox_protocol: m.truthbox,
          merkle_root: m.chain?.merkleRoot,
          chain_head: m.chain?.head,
          signature: m.signature?.value,
          public_key_jwk: m.signature?.publicKeyJwk,
          video_sha256: m.video?.sha256 ?? null,
          snapshot_hashes: Object.fromEntries(
            Object.entries(m.snapshots || {}).map(([k, s]) => [k, s.sha256])
          ),
          dispatch_nonce: m.order?.nonce,
        },
      },
    },
  };
}
