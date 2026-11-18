-- THE STUDIO DEPARTMENT ROW: the exact undo of migrations/20261118000100_department_studio.sql. NOT a migration: it lives outside migrations/ so nothing applies it by accident.
-- It deletes the 'studio' row and nothing else. People's "Tell me when it's ready" rows for Studio go with it (department_interest.department is a cascading reference); no other department's rows are touched.
-- The site and the panel then show no Studio again (they only show a department the database lists). Running it twice is harmless.

begin;
delete from public.departments where id = 'studio';
commit;
