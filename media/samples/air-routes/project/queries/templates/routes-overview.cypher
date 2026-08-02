MATCH (a:Airport)-[r:ROUTE]->(b:Airport)
RETURN a.code AS source,
       b.code AS target,
       type(r) AS type,
       a.code AS label,
       r.dist AS dist,
       a.region AS region
