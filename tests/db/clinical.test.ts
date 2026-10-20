import { afterAll, describe, expect, it } from "vitest";
import { asUser, closePool, createPatientRow, pool, seedClinic } from "./helpers";

afterAll(closePool);

const entry = (clinicId: string, patientId: string, authorId: string, kind = "evolucion") =>
  pool.query<{ id: string }>(
    'insert into clinical_entries (clinic_id, patient_id, kind, body, author_membership_id) values ($1, $2, $3, \'{"texto":"x"}\', $4) returning id',
    [clinicId, patientId, kind, authorId],
  );

describe("clinical record", () => {
  it("assistants cannot read it; dentists and admins can", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    await entry(a.clinicId, patientId, a.dentist.membershipId);
    expect(
      (await asUser(a.assistant.userId, (c) => c.query("select id from clinical_entries")))
        .rowCount,
    ).toBe(0);
    expect(
      (await asUser(a.dentist.userId, (c) => c.query("select id from clinical_entries"))).rowCount,
    ).toBe(1);
    expect(
      (await asUser(a.admin.userId, (c) => c.query("select id from clinical_entries"))).rowCount,
    ).toBe(1);
  });

  it("another clinic's dentist sees nothing", async () => {
    const a = await seedClinic();
    const b = await seedClinic();
    await entry(a.clinicId, await createPatientRow(a.clinicId), a.dentist.membershipId);
    expect(
      (await asUser(b.dentist.userId, (c) => c.query("select id from clinical_entries"))).rowCount,
    ).toBe(0);
  });

  it("entries are append-only: update and delete are refused, even for the owner role", async () => {
    const a = await seedClinic();
    const { rows } = await entry(
      a.clinicId,
      await createPatientRow(a.clinicId),
      a.dentist.membershipId,
    );
    const id = rows[0]?.id;
    await expect(
      pool.query("update clinical_entries set body = '{}' where id = $1", [id]),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query("delete from clinical_entries where id = $1", [id])).rejects.toThrow(
      /append-only/,
    );
  });

  it("a correction note must point at the entry it corrects, and nothing else may", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    const { rows } = await entry(a.clinicId, patientId, a.dentist.membershipId);
    await expect(
      entry(a.clinicId, patientId, a.dentist.membershipId, "nota_correccion"),
    ).rejects.toThrow(/check constraint/);
    await pool.query(
      "insert into clinical_entries (clinic_id, patient_id, kind, body, author_membership_id, corrects_entry_id) values ($1, $2, 'nota_correccion', '{\"texto\":\"fe de erratas\"}', $3, $4)",
      [a.clinicId, patientId, a.dentist.membershipId, rows[0]?.id],
    );
  });

  it("odontogram marks accept only valid FDI teeth and surfaces", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    const mark = (tooth: number, surface: string | null) =>
      pool.query(
        "insert into odontogram_marks (clinic_id, patient_id, tooth_fdi, surface, condition, author_membership_id) values ($1, $2, $3, $4, 'caries', $5)",
        [a.clinicId, patientId, tooth, surface, a.dentist.membershipId],
      );
    await mark(18, "O");
    await mark(85, null);
    await expect(mark(19, "O")).rejects.toThrow(/check constraint/);
    await expect(mark(11, "X")).rejects.toThrow(/check constraint/);
  });

  it("the access log is append-only and visible to admins only", async () => {
    const a = await seedClinic();
    const patientId = await createPatientRow(a.clinicId);
    await asUser(a.dentist.userId, (c) =>
      c.query(
        "insert into record_access_log (clinic_id, patient_id, membership_id) values ($1, $2, $3)",
        [a.clinicId, patientId, a.dentist.membershipId],
      ),
    );
    expect(
      (await asUser(a.dentist.userId, (c) => c.query("select id from record_access_log"))).rowCount,
    ).toBe(0);
    expect(
      (await asUser(a.admin.userId, (c) => c.query("select id from record_access_log"))).rowCount,
    ).toBe(1);
    await expect(pool.query("delete from record_access_log")).rejects.toThrow(/append-only/);
  });
});
